"""Where document photos and signatures are stored.

- On Vercel: a *private* Vercel Blob store (the function filesystem is read-only and ephemeral).
  Requires BLOB_READ_WRITE_TOKEN, which Vercel adds when a Blob store is connected to the project.
- Locally: backend/data/uploads (or PLATHOST_UPLOADS_DIR).

Identity documents are sensitive personal data, so blobs are always written with access="private".
"""
from __future__ import annotations

import os
from pathlib import Path

from . import db

# Deployed on Vercel (not `vercel dev`, which reports VERCEL_ENV=development).
ON_VERCEL = os.environ.get("VERCEL_ENV") in ("production", "preview")


def _blob_token() -> str | None:
    return os.environ.get("BLOB_READ_WRITE_TOKEN") or os.environ.get("VERCEL_BLOB_READ_WRITE_TOKEN")


def backend() -> str:
    if _blob_token():
        return "blob"
    if ON_VERCEL:
        raise RuntimeError(
            "No hay almacenamiento configurado: conecte un Blob store privado al proyecto "
            "(define BLOB_READ_WRITE_TOKEN)."
        )
    return "local"


def save(path: str, content: bytes, content_type: str) -> str:
    """Store a file and return the reference saved in the database."""
    if backend() == "blob":
        from vercel.blob import BlobClient

        result = BlobClient().put(
            f"plathost/{path}", content, access="private", content_type=content_type, add_random_suffix=True
        )
        return result.pathname

    target: Path = db.UPLOADS_DIR / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return path
