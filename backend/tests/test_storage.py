from app import db, storage


def test_local_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "UPLOADS_DIR", tmp_path)
    ref = storage.save("CS1/doc.jpg", b"img", "image/jpeg")
    assert ref == "CS1/doc.jpg" and (tmp_path / ref).read_bytes() == b"img"
