"""Identity document types accepted for hotel registration in Colombia.

Codes follow the ones used by Migración Colombia (SIRE) and the Tarjeta de Registro
Hotelero (TRA). Each type defines how its number is validated, the age range and
nationality it implies, and how the photo is verified:

  - "mrz"    the photo must contain a readable, valid MRZ (passports)
  - "photo"  photo only, no automated reading (Colombian-issued documents)
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from datetime import date


@dataclass(frozen=True)
class DocType:
    code: str
    pattern: str              # full-match regex on the normalized number
    verification: str         # mrz | photo
    min_age: int | None = None
    max_age: int | None = None
    nationality: str | None = None   # "COL" = must be Colombian, "!COL" = must be foreign
    card_ratio: float = 85.6 / 54    # ID-1 card; passports are ID-3 (125 × 88)


DOC_TYPES: dict[str, DocType] = {d.code: d for d in [
    DocType("CC", r"\d{3,10}", "photo", min_age=18, nationality="COL"),            # Cédula de ciudadanía
    DocType("TI", r"\d{10,11}", "photo", min_age=7, max_age=17, nationality="COL"),  # Tarjeta de identidad
    DocType("CE", r"\d{3,10}", "photo", nationality="!COL"),                         # Cédula de extranjería
    DocType("PA", r"[0-9A-Z]{5,20}", "mrz", card_ratio=125 / 88),                   # Pasaporte
]}


def normalize_number(value: str) -> str:
    return re.sub(r"[\s.\-]", "", value or "").upper()


def age_on(birth: date, on: date) -> int:
    return on.year - birth.year - ((on.month, on.day) < (birth.month, birth.day))


def validate(doc_type: str, number: str, birth_date: str, nationality: str, on: date) -> dict[str, str]:
    """Return {field: error} for one guest's identity data."""
    errors: dict[str, str] = {}
    dt = DOC_TYPES.get(doc_type)
    if not dt:
        return {"doc_type": "required" if not doc_type else "invalid"}

    num = normalize_number(number)
    if not num:
        errors["doc_number"] = "required"
    elif not re.fullmatch(dt.pattern, num):
        errors["doc_number"] = "invalid"

    if not birth_date:
        errors["birth_date"] = "required"
    else:
        try:
            birth = date.fromisoformat(birth_date)
            age = age_on(birth, on)
            if birth >= date.today() or age > 120:
                errors["birth_date"] = "invalid"
            elif (dt.min_age is not None and age < dt.min_age) or (dt.max_age is not None and age > dt.max_age):
                errors["birth_date"] = "age_doc"
        except ValueError:
            errors["birth_date"] = "invalid"

    if not nationality:
        errors["nationality"] = "required"
    elif dt.nationality == "COL" and nationality != "COL":
        errors["nationality"] = "nat_doc"
    elif dt.nationality == "!COL" and nationality == "COL":
        errors["nationality"] = "nat_doc"
    return errors


def public_definitions() -> list[dict]:
    return [asdict(d) for d in DOC_TYPES.values()]
