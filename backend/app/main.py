"""PlatHost — pre-check-in API."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
import unicodedata
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import documents, mrz, storage
from psycopg.types.json import Jsonb

from . import db
from .db import connect, init_db

_DEV_SECRET = "dev-secret-change-me"
SECRET = os.environ.get("PLATHOST_SECRET", _DEV_SECRET).encode()
if storage.ON_VERCEL and SECRET == _DEV_SECRET.encode():
    raise RuntimeError("PLATHOST_SECRET no está configurado en Vercel.")
ADMIN_KEY = os.environ.get("PLATHOST_ADMIN_KEY", "")
TOKEN_TTL = 60 * 60 * 2  # 2 h
MAX_IMAGE_BYTES = 4 * 1024 * 1024  # Vercel Functions reject request bodies > 4.5 MB
RULES = json.loads((Path(__file__).parent / "rules.json").read_text(encoding="utf-8"))

@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="PlatHost API", lifespan=lifespan)


# ---------------------------------------------------------------- helpers

def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^A-Z0-9]", " ", s.upper()).split())


def make_token(code: str) -> str:
    payload = f"{code}.{int(time.time()) + TOKEN_TTL}"
    sig = hmac.new(SECRET, payload.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(payload.encode()).decode() + "." + base64.urlsafe_b64encode(sig).decode()


def read_token(token: str) -> str | None:
    try:
        p64, s64 = token.split(".")
        payload = base64.urlsafe_b64decode(p64).decode()
        expected = hmac.new(SECRET, payload.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, base64.urlsafe_b64decode(s64)):
            return None
        code, exp = payload.rsplit(".", 1)
        return code if int(exp) > time.time() else None
    except Exception:
        return None


def current_code(authorization: str = Header(default="")) -> str:
    code = read_token(authorization.removeprefix("Bearer ").strip())
    if not code:
        raise HTTPException(401, "Sesión expirada. Ingrese de nuevo.")
    return code


def get_reservation(code: str) -> dict:
    with connect() as conn:
        r = conn.execute("SELECT * FROM reservations WHERE code = %s", (code,)).fetchone()
    if not r:
        raise HTTPException(404, "Reserva no encontrada")
    return r


def surname_matches(expected: str, found: str) -> bool:
    exp, got = set(normalize(expected).split()), set(normalize(found).split())
    return bool(exp and got and exp & got)


# ---------------------------------------------------------------- models

class LoginIn(BaseModel):
    reservation: str = Field(min_length=3, max_length=32)
    last_name: str = Field(min_length=2, max_length=80)


class Companion(BaseModel):
    full_name: str = ""
    doc_type: str = ""
    doc_number: str = ""
    birth_date: str = ""
    nationality: str = ""


class CheckinData(BaseModel):
    """Fields the guest fills in (everything else comes from the reservation)."""
    email: str = ""
    phone: str = ""
    nationality: str = ""
    doc_type: str = ""
    doc_number: str = ""
    birth_date: str = ""
    residence_country: str = ""
    vehicle_plate: str = ""
    visit_reason: str = ""
    emergency_name: str = ""
    emergency_phone: str = ""
    companions: list[Companion] = []
    rules_accepted: bool = False
    data_authorized: bool = False
    language: str = "es"


class SubmitIn(BaseModel):
    data: CheckinData
    signature: str  # data:image/png;base64,...


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ---------------------------------------------------------------- routes

@app.post("/api/session")
def login(body: LoginIn):
    code = body.reservation.strip().upper().replace(" ", "")
    with connect() as conn:
        r = conn.execute("SELECT code, last_name FROM reservations WHERE code = %s", (code,)).fetchone()
    # Same error for unknown code and wrong surname: don't leak which reservations exist.
    if not r or not surname_matches(r["last_name"], body.last_name):
        raise HTTPException(401, "No encontramos una reserva con esos datos.")
    return {"token": make_token(code)}


@app.get("/api/checkin")
def get_checkin(code: str = Depends(current_code)):
    reservation = get_reservation(code)
    with connect() as conn:
        checkin = conn.execute("SELECT * FROM checkins WHERE code = %s", (code,)).fetchone()
        scans = latest_scans(conn, code)
    # {"0:PA": "verified", "1:CC": "captured", …}
    latest = {f"{idx}:{doc_type}": status for (idx, doc_type), status in scans.items()}
    return {
        "reservation": reservation,
        "data": checkin["data"] if checkin else {},
        "status": checkin["status"] if checkin else "pending",
        "submitted_at": checkin["submitted_at"] if checkin else None,
        "scans": latest,
    }


def _save(code: str, data: CheckinData, status: str = "draft", signature: str | None = None) -> None:
    now = datetime.now(timezone.utc)
    with connect() as conn:
        existing = conn.execute("SELECT status FROM checkins WHERE code = %s", (code,)).fetchone()
        if existing and existing["status"] == "submitted" and status == "draft":
            raise HTTPException(409, "El pre-check-in ya fue enviado.")
        conn.execute(
            """INSERT INTO checkins (code, data, status, signature, updated_at, submitted_at)
               VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT(code) DO UPDATE SET data=excluded.data, status=excluded.status,
                 signature=COALESCE(excluded.signature, checkins.signature),
                 updated_at=excluded.updated_at,
                 submitted_at=COALESCE(excluded.submitted_at, checkins.submitted_at)""",
            (code, Jsonb(data.model_dump()), status, signature, now, now if status == "submitted" else None),
        )


@app.put("/api/checkin")
def save_draft(data: CheckinData, code: str = Depends(current_code)):
    _save(code, data)
    return {"ok": True}


def latest_scans(conn, code: str) -> dict[tuple[int, str], str]:
    """Most recent scan status per (guest_index, doc_type)."""
    rows = conn.execute(
        "SELECT guest_index, doc_type, status FROM document_scans WHERE code = %s ORDER BY id", (code,)
    ).fetchall()
    return {(r["guest_index"], r["doc_type"]): r["status"] for r in rows}


@app.post("/api/checkin/submit")
def submit(body: SubmitIn, code: str = Depends(current_code)):
    reservation = get_reservation(code)
    d = body.data
    errors: dict[str, str] = {}
    on = reservation["check_in"]

    for k in ("email", "phone", "residence_country", "visit_reason", "emergency_name", "emergency_phone"):
        if not getattr(d, k).strip():
            errors[k] = "required"
    if d.email.strip() and not EMAIL_RE.match(d.email.strip()):
        errors["email"] = "invalid"
    errors |= documents.validate(d.doc_type, d.doc_number, d.birth_date, d.nationality, on)

    expected = reservation["guests"] - 1
    if len(d.companions) != expected:
        errors["companions"] = f"expected {expected}"
    for i, c in enumerate(d.companions):
        if not c.full_name.strip():
            errors[f"companions.{i}.full_name"] = "required"
        for k, v in documents.validate(c.doc_type, c.doc_number, c.birth_date, c.nationality, on).items():
            errors[f"companions.{i}.{k}"] = v

    # Every guest needs a photo of the document type they declared.
    with connect() as conn:
        scans = latest_scans(conn, code)
    guests = [(0, d.doc_type)] + [(i + 1, c.doc_type) for i, c in enumerate(d.companions)]
    for idx, doc_type in guests:
        if doc_type and (idx, doc_type) not in scans:
            errors["document_photo" if idx == 0 else f"companions.{idx - 1}.document_photo"] = "required"

    if not d.rules_accepted:
        errors["rules_accepted"] = "required"
    if not d.data_authorized:
        errors["data_authorized"] = "required"
    if not body.signature.startswith("data:image/png;base64,") or len(body.signature) < 1000:
        errors["signature"] = "required"
    if errors:
        raise HTTPException(422, {"message": "Hay campos por completar.", "fields": errors})

    d.doc_number = documents.normalize_number(d.doc_number)
    for c in d.companions:
        c.doc_number = documents.normalize_number(c.doc_number)
    sig_bytes = base64.b64decode(body.signature.split(",", 1)[1])
    sig_ref = storage.save(f"{code}/signature.png", sig_bytes, "image/png")
    _save(code, d, status="submitted", signature=sig_ref)
    return {"ok": True}


def _check_mrz(result: mrz.MRZResult, reservation: dict, name_ref: str) -> tuple[str, list[dict]]:
    checks = [{"id": "checksums", "ok": result.checksums_ok}]
    # passports must carry a TD3 "P" MRZ
    checks.append({"id": "doc_kind", "ok": result.format == "TD3" and result.document_type.startswith("P")})
    checks.append({"id": "not_expired", "ok": bool(result.expiry_date and result.expiry_date >= reservation["check_out"])})
    checks.append({"id": "birth_date", "ok": bool(result.birth_date and result.birth_date < date.today())})
    if name_ref.strip():
        checks.append({"id": "name_match", "ok": surname_matches(name_ref, f"{result.surname} {result.given_names}")})

    hard = {"checksums", "doc_kind", "not_expired"}
    if not all(c["ok"] for c in checks if c["id"] in hard):
        return "failed", checks
    return ("verified" if all(c["ok"] for c in checks) else "review"), checks


@app.post("/api/documents/verify")
async def verify_document(
    guest_index: int = Form(..., ge=0, le=20),
    doc_type: str = Form(...),
    ocr_text: str = Form(""),
    expected_name: str = Form(""),
    image: UploadFile = File(...),
    code: str = Depends(current_code),
):
    """Store a document photo and verify it according to its type.

    For documents with an MRZ, OCR runs in the browser (tesseract.js) and the server is the
    authority: it parses the MRZ and checks ICAO check digits, validity and name. Colombian
    documents are stored as a photo only, for review at the front desk.

    Statuses: verified | review | failed | unreadable | captured (photo only).
    """
    reservation = get_reservation(code)
    if guest_index >= reservation["guests"]:
        raise HTTPException(400, "Huésped inválido")
    dt = documents.DOC_TYPES.get(doc_type)
    if not dt:
        raise HTTPException(400, "Tipo de documento inválido")
    content = await image.read()
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Imagen demasiado grande")
    if not (content.startswith(b"\xff\xd8") or content.startswith(b"\x89PNG")):
        raise HTTPException(415, "Formato de imagen no soportado")

    fields, checks = None, []
    if dt.verification == "photo":
        status = "captured"
    elif (result := mrz.parse(ocr_text)) is None:
        status = "unreadable"
    else:
        fields = result.to_dict()
        name_ref = reservation["last_name"] if guest_index == 0 else expected_name
        status, checks = _check_mrz(result, reservation, name_ref)

    is_png = content.startswith(b"\x89PNG")
    ref = await run_in_threadpool(
        storage.save,
        f"{code}/doc-{guest_index}-{doc_type}-{uuid.uuid4().hex[:8]}.{'png' if is_png else 'jpg'}",
        content,
        "image/png" if is_png else "image/jpeg",
    )
    with connect() as conn:
        conn.execute(
            """INSERT INTO document_scans (code, guest_index, doc_type, image_path, result, status)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (code, guest_index, doc_type, ref, Jsonb({"fields": fields, "checks": checks}), status),
        )
    return {"status": status, "fields": fields, "checks": checks}


@app.get("/api/document-types")
def document_types():
    return documents.public_definitions()


@app.get("/api/rules")
def rules():
    return RULES


@app.get("/api/admin/checkins")
def admin_list(x_admin_key: str = Header(default="")):
    if not ADMIN_KEY or not hmac.compare_digest(x_admin_key, ADMIN_KEY):
        raise HTTPException(403, "Forbidden")
    with connect() as conn:
        rows = conn.execute(
            """SELECT r.*, c.status, c.data, c.submitted_at FROM reservations r
               LEFT JOIN checkins c ON c.code = r.code ORDER BY r.check_in"""
        ).fetchall()
    return rows


# Serve the built frontend (npm run build) from the same origin in production.
_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _dist.exists() and not storage.ON_VERCEL:
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
