import os
from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

# PLATHOST_DATABASE_URL wins; DATABASE_URL is what the Neon integration on Vercel injects.
DATABASE_URL = (
    os.environ.get("PLATHOST_DATABASE_URL")
    or os.environ.get("DATABASE_URL")
    or "postgresql://plathost:plathost@localhost:5433/plathost"
)
UPLOADS_DIR = Path(os.environ.get("PLATHOST_UPLOADS_DIR", Path(__file__).resolve().parent.parent / "data" / "uploads"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS reservations (
    code        TEXT PRIMARY KEY,
    property    TEXT NOT NULL,
    room        TEXT NOT NULL,
    check_in    DATE NOT NULL,
    check_out   DATE NOT NULL,
    first_name  TEXT NOT NULL,
    last_name   TEXT NOT NULL,
    email       TEXT,
    phone       TEXT,
    guests      INTEGER NOT NULL DEFAULT 1 CHECK (guests > 0)
);
CREATE TABLE IF NOT EXISTS checkins (
    code          TEXT PRIMARY KEY REFERENCES reservations(code),
    data          JSONB NOT NULL DEFAULT '{}',
    status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
    signature     TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at  TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS document_scans (
    id           BIGSERIAL PRIMARY KEY,
    code         TEXT NOT NULL REFERENCES reservations(code),
    guest_index  INTEGER NOT NULL,
    doc_type     TEXT NOT NULL,
    image_path   TEXT NOT NULL,
    result       JSONB NOT NULL,
    status       TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_scans_code_idx ON document_scans (code, guest_index);
"""

# Sample reservations. In production these come from the PMS / channel manager.
SEED = [
    # From "Check in 1102, Agosto 21 2026"
    dict(code="CS1102", property="Class Suites", room="1102", check_in="2026-08-21",
         check_out="2026-08-28", first_name="Rafael", last_name="Perez",
         email="rps10833@gmail.com", phone="+11814664634", guests=5),
    dict(code="CS0507", property="Class Suites", room="507", check_in="2026-10-12",
         check_out="2026-10-15", first_name="Ana María", last_name="Gómez",
         email="ana.gomez@example.com", phone="+573001234567", guests=2),
]


def init_db() -> None:
    with connect() as conn:
        conn.execute(SCHEMA)
        for r in SEED:
            conn.execute(
                """INSERT INTO reservations VALUES (%(code)s, %(property)s, %(room)s, %(check_in)s,
                   %(check_out)s, %(first_name)s, %(last_name)s, %(email)s, %(phone)s, %(guests)s)
                   ON CONFLICT (code) DO NOTHING""",
                r,
            )


@contextmanager
def connect():
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        yield conn
