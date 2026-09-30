import sys
import types

import pytest

from app import db, storage


def test_local_storage(tmp_path, monkeypatch):
    monkeypatch.delenv("BLOB_READ_WRITE_TOKEN", raising=False)
    monkeypatch.setattr(storage, "ON_VERCEL", False)
    monkeypatch.setattr(db, "UPLOADS_DIR", tmp_path)
    ref = storage.save("CS1/doc.jpg", b"img", "image/jpeg")
    assert ref == "CS1/doc.jpg" and (tmp_path / ref).read_bytes() == b"img"


def test_blob_storage_is_private(monkeypatch):
    calls = {}

    class FakeClient:
        def put(self, path, body, **kw):
            calls.update(path=path, body=body, **kw)
            return types.SimpleNamespace(pathname=path.replace(".jpg", "-abc.jpg"))

    fake = types.ModuleType("vercel.blob")
    fake.BlobClient = FakeClient
    monkeypatch.setitem(sys.modules, "vercel.blob", fake)
    monkeypatch.setenv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test")

    ref = storage.save("CS1/doc.jpg", b"img", "image/jpeg")
    assert ref == "plathost/CS1/doc-abc.jpg"
    assert calls["access"] == "private" and calls["add_random_suffix"] is True


def test_vercel_without_blob_fails_loudly(monkeypatch):
    monkeypatch.delenv("BLOB_READ_WRITE_TOKEN", raising=False)
    monkeypatch.delenv("VERCEL_BLOB_READ_WRITE_TOKEN", raising=False)
    monkeypatch.setattr(storage, "ON_VERCEL", True)
    with pytest.raises(RuntimeError, match="Blob"):
        storage.save("CS1/doc.jpg", b"img", "image/jpeg")
