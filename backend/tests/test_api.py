import os

import psycopg
import pytest
from fastapi.testclient import TestClient

from app import db, main, mrz

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 100


def build_td3(surname, given, number, nat, dob, sex, exp, optional=""):
    l1 = f"P<{nat}{surname}<<{given.replace(' ', '<')}".ljust(44, "<")[:44]
    num = number.ljust(9, "<")
    opt = optional.ljust(14, "<")
    cd = mrz.check_digit
    cd_opt = cd(opt) if optional else "<"
    body = num + cd(num) + nat + dob + cd(dob) + sex + exp + cd(exp) + opt + cd_opt
    comp = num + cd(num) + dob + cd(dob) + exp + cd(exp) + opt + cd_opt
    return l1, body + cd(comp)


RAFAEL = build_td3("PEREZ", "RAFAEL", "A23386057", "USA", "030217", "M", "320115")


@pytest.fixture
def client(tmp_path, monkeypatch):
    url = os.environ.get("PLATHOST_TEST_DATABASE_URL",
                         "postgresql://plathost:plathost@localhost:5433/plathost_test")
    with psycopg.connect(url) as conn:
        conn.execute("DROP TABLE IF EXISTS document_scans, passport_scans, checkins, reservations")
    monkeypatch.setattr(db, "DATABASE_URL", url)
    monkeypatch.setattr(db, "UPLOADS_DIR", tmp_path / "up")
    monkeypatch.setattr(main, "_db_ready", False)
    with TestClient(main.app) as c:
        yield c


def login(client, code="CS1102", last="pérez"):
    r = client.post("/api/session", json={"reservation": code, "last_name": last})
    return r


def auth(client):
    return {"Authorization": "Bearer " + login(client).json()["token"]}


# ---------------------------------------------------------------- MRZ

def test_icao_specimen():
    # ICAO 9303 specimen passport
    text = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10"
    r = mrz.parse(text)
    assert r and r.checksums_ok
    assert (r.surname, r.given_names, r.document_number) == ("ERIKSSON", "ANNA MARIA", "L898902C3")
    assert r.birth_date.isoformat() == "1974-08-12"


def test_ocr_noise_is_corrected():
    l1, l2 = RAFAEL
    noisy = l2.replace("0302", "O3O2").replace("A23386057", "A2338GO57")
    r = mrz.parse(f"garbage line\n{l1.replace('<', ' <', 3)}\n{noisy}\n")
    assert r and r.checksums_ok
    assert r.document_number == "A23386057"
    assert r.birth_date.isoformat() == "2003-02-17"


def test_ocr_real_world_misreads():
    # Actual tesseract.js output from a rendered passport page in the browser
    text = ("P<USAPEREZ<<RAFAEL<<<<<<<<<<<<<<<<<<<<<LL<L<<<\n"
            "A233860572USA0302173M3201152<<<<<<<<<<<<<<<H\n")
    r = mrz.parse(text)
    assert r and r.checksums_ok
    assert (r.surname, r.given_names) == ("PEREZ", "RAFAEL")
    # extra filler characters in both lines
    long = ("P<USAOLEA<<ERICK<<<<<<<<<<<<<<<<<<<<L<<L<LLL<L<L<\n"
            "A822280369USA0405133M2609016<<<<<<<<<<<<<<<<<<4\n")
    r = mrz.parse(long)
    assert r and r.checksums_ok and (r.surname, r.given_names) == ("OLEA", "ERICK")
    # "0" read as "P" inside a date
    r = mrz.parse("P<USAOLEA<<ERICK<<<<<<<<<<<<<<<<<<<<<<<<<<<<\nA822280369USAP405133M2909015<<<<<<<<<<<<<<<4")
    assert r and r.checksums_ok and r.birth_date.isoformat() == "2004-05-13"
    # but a wrong *digit* in the composite position is still rejected
    assert not mrz.parse(text.replace("<H", "<5")).checksums_ok


def test_tampered_mrz_fails():
    l1, l2 = RAFAEL
    r = mrz.parse(l1 + "\n" + l2.replace("030217", "030218"))
    assert r and not r.checksums_ok


# ---------------------------------------------------------------- API

def test_login(client):
    assert login(client).status_code == 200
    assert login(client, code="cs 1102", last="PEREZ").status_code == 200
    assert login(client, last="Gomez").status_code == 401
    assert login(client, code="XX999").status_code == 401


def test_reservation_prefill(client):
    r = client.get("/api/checkin", headers=auth(client)).json()
    assert r["reservation"]["room"] == "1102"
    assert r["reservation"]["guests"] == 5
    assert r["status"] == "pending"
    assert client.get("/api/checkin").status_code == 401


def scan(client, h, idx, doc_type, text="", name=""):
    return client.post("/api/documents/verify", headers=h,
                       data={"guest_index": idx, "doc_type": doc_type, "ocr_text": text, "expected_name": name},
                       files={"image": ("p.png", PNG, "image/png")}).json()


def test_passport_verify(client):
    h = auth(client)
    r = scan(client, h, 0, "PA", "\n".join(RAFAEL))
    assert r["status"] == "verified", r
    assert r["fields"]["document_number"] == "A23386057"

    expired = build_td3("PEREZ", "RAFAEL", "A23386057", "USA", "030217", "M", "260801")
    assert scan(client, h, 0, "PA", "\n".join(expired))["status"] == "failed"

    other = build_td3("CRUZ", "JESUS", "656077348", "USA", "030218", "M", "310101")
    # valid document, but not the reservation holder
    assert scan(client, h, 0, "PA", "\n".join(other))["status"] == "review"
    assert scan(client, h, 1, "PA", "\n".join(other), "Jesus Cruz")["status"] == "verified"
    assert scan(client, h, 0, "PA", "nothing")["status"] == "unreadable"


def test_photo_only_documents(client):
    h = auth(client)
    # Colombian documents: no OCR, the photo is stored for front-desk review
    r = scan(client, h, 0, "CC", "\n".join(RAFAEL))
    assert r == {"status": "captured", "fields": None, "checks": []}
    assert scan(client, h, 1, "CE", "")["status"] == "captured"
    for removed in ("DE", "XX"):
        assert client.post("/api/documents/verify", headers=h, data={"guest_index": 0, "doc_type": removed},
                           files={"image": ("p.png", PNG, "image/png")}).status_code == 400
    assert client.post("/api/documents/verify", headers=h, data={"guest_index": 0, "doc_type": "XX"},
                       files={"image": ("p.png", PNG, "image/png")}).status_code == 400


def test_document_rules():
    from datetime import date
    from app.documents import validate
    on = date(2026, 8, 21)
    assert validate("CC", "1.020.304.050", "1990-01-01", "COL", on) == {}
    assert validate("CC", "1020304050", "2012-01-01", "COL", on) == {"birth_date": "age_doc"}  # minor with CC
    assert validate("TI", "1020304050", "2012-01-01", "COL", on) == {}
    assert validate("TI", "12345", "2012-01-01", "COL", on) == {"doc_number": "invalid"}
    assert validate("CC", "1020304050", "1990-01-01", "USA", on) == {"nationality": "nat_doc"}
    assert validate("CE", "123456", "1990-01-01", "COL", on) == {"nationality": "nat_doc"}
    assert validate("CE", "123456", "1990-01-01", "VEN", on) == {}
    assert validate("PA", "A2338-6057", "2003-02-17", "USA", on) == {}
    assert validate("ZZ", "1", "2000-01-01", "USA", on) == {"doc_type": "invalid"}


def full_data(companions=4):
    return {
        "email": "rps10833@gmail.com", "phone": "+11814664634", "nationality": "USA",
        "doc_type": "PA", "doc_number": "A23386057", "birth_date": "2003-02-17",
        "residence_country": "PRI", "visit_reason": "vacation",
        "emergency_name": "Maria Perez", "emergency_phone": "+11815139335",
        "companions": [{"full_name": f"Guest {i}", "doc_type": "PA", "doc_number": f"X1234{i}",
                        "birth_date": "2000-01-01", "nationality": "USA"} for i in range(companions)],
        "rules_accepted": True, "data_authorized": True,
    }


def test_draft_and_submit(client):
    h = auth(client)
    assert client.put("/api/checkin", headers=h, json={"email": "a@b.co"}).status_code == 200
    assert client.get("/api/checkin", headers=h).json()["data"]["email"] == "a@b.co"

    sig = "data:image/png;base64," + "A" * 3000
    r = client.post("/api/checkin/submit", headers=h, json={"data": full_data(3), "signature": sig})
    assert r.status_code == 422 and "companions" in r.json()["detail"]["fields"]

    # document photos are required for every guest
    r = client.post("/api/checkin/submit", headers=h, json={"data": full_data(), "signature": sig})
    fields = r.json()["detail"]["fields"]
    assert r.status_code == 422 and "document_photo" in fields and "companions.3.document_photo" in fields

    for i in range(5):
        scan(client, h, i, "PA", "\n".join(RAFAEL) if i == 0 else "")
    assert client.get("/api/checkin", headers=h).json()["scans"]["0:PA"] == "verified"
    r = client.post("/api/checkin/submit", headers=h, json={"data": full_data(), "signature": sig})
    assert r.status_code == 200, r.json()
    got = client.get("/api/checkin", headers=h).json()
    assert got["status"] == "submitted" and got["submitted_at"]
    assert client.put("/api/checkin", headers=h, json={}).status_code == 409


def test_health_local(client):
    assert client.get("/api/health").json() == {"ok": True, "database": "ok"}

