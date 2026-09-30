"""Clear check-ins, scans and uploaded files for the demo reservations.

    python -m app.reset_demo
"""
import shutil

from . import db


def main() -> None:
    db.init_db()
    codes = [r["code"] for r in db.SEED]
    with db.connect() as conn:
        conn.execute("DELETE FROM document_scans WHERE code = ANY(%s)", (codes,))
        conn.execute("DELETE FROM checkins WHERE code = ANY(%s)", (codes,))
    for code in codes:
        shutil.rmtree(db.UPLOADS_DIR / code, ignore_errors=True)
    print("Demo reservations reset:", ", ".join(codes))


if __name__ == "__main__":
    main()
