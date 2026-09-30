"""Where document photos and signatures are stored: backend/data/uploads (or PLATHOST_UPLOADS_DIR)."""
from __future__ import annotations

from pathlib import Path

from . import db


def save(path: str, content: bytes, content_type: str) -> str:
    """Store a file and return the reference saved in the database."""
    target: Path = db.UPLOADS_DIR / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return path
