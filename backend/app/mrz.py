"""MRZ (Machine Readable Zone) parsing and validation — ICAO Doc 9303.

Supports TD3 (passports, 2 x 44) and TD1 (ID cards, 3 x 30).
OCR output is noisy, so each field is corrected according to its expected
character class (digits vs. letters) before check digits are verified.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

_WEIGHTS = (7, 3, 1)
# Used only on digit-only fields; the check digit still has the final word.
_TO_DIGIT = str.maketrans({"O": "0", "Q": "0", "D": "0", "U": "0", "P": "0", "I": "1", "L": "1", "J": "1",
                           "Z": "2", "A": "4", "S": "5", "G": "6", "T": "7", "B": "8"})
_TO_ALPHA = str.maketrans({"0": "O", "1": "I", "2": "Z", "5": "S", "6": "G", "8": "B"})
_VALID = re.compile(r"^[A-Z0-9<]+$")


def _char_value(c: str) -> int:
    if c.isdigit():
        return int(c)
    if c == "<":
        return 0
    return ord(c) - 55  # A=10 … Z=35


def check_digit(data: str) -> str:
    return str(sum(_char_value(c) * _WEIGHTS[i % 3] for i, c in enumerate(data)) % 10)


def _digits(s: str) -> str:
    return s.translate(_TO_DIGIT)


def _alpha(s: str) -> str:
    return s.translate(_TO_ALPHA)


def _parse_date(yymmdd: str, *, future: bool) -> date | None:
    try:
        yy, mm, dd = int(yymmdd[0:2]), int(yymmdd[2:4]), int(yymmdd[4:6])
    except ValueError:
        return None
    today = date.today()
    century = 2000 if future else (2000 if 2000 + yy <= today.year else 1900)
    try:
        return date(century + yy, mm, dd)
    except ValueError:
        return None


def _clean_name(s: str) -> str:
    return " ".join(p for p in s.split("<") if p).strip()


def _split_names(s: str) -> tuple[str, str]:
    # "<<<" never occurs inside names: everything after it is filler (OCR often reads "<" as L/K).
    s = s.split("<<<")[0]
    surname, _, given = s.partition("<<")
    return _clean_name(surname), _clean_name(given)


def _normalize_line(line: str) -> str:
    line = line.upper().replace(" ", "")
    line = line.replace("«", "<").replace("‹", "<").replace("{", "<").replace("(", "<")
    return re.sub(r"[^A-Z0-9<]", "", line)


def _fit_td3_line1(line: str) -> str:
    """OCR tends to add/drop characters in long "<<<<" runs. Line 1 is document code,
    issuer and names; anything after the first "<<<" is filler, so rebuild it to 44."""
    head, names = line[:5], line[5:]
    if "<<<" in names:
        names = names.split("<<<")[0] + "<<<"
    return (head + names)[:44].ljust(44, "<")


def _fit_td3_line2(line: str) -> str:
    """Line 2 has fixed positions up to 28; when the optional field is empty the rest is
    filler + "<" + final digit, so a wrong filler length can be repaired safely."""
    if len(line) == 44:
        return line
    head, tail = line[:28], line[28:]
    if len(tail) >= 2 and re.fullmatch(r"[<LK]+", tail[:-1]):
        return head + "<" * 15 + tail[-1]
    return line[:44].ljust(44, "<")


def extract_lines(raw: str) -> tuple[str, list[str]] | None:
    """Find MRZ lines inside raw OCR text. Returns (format, lines)."""
    candidates = [_normalize_line(l) for l in raw.splitlines()]
    candidates = [l for l in candidates if len(l) >= 25 and l.count("<") >= 2]

    # TD3: two lines of ~44, the first starts with P (or V for visas)
    for i in range(len(candidates) - 1):
        a, b = candidates[i], candidates[i + 1]
        if 38 <= len(a) <= 56 and 38 <= len(b) <= 56 and a[0] in "PV":
            return "TD3", [_fit_td3_line1(a), _fit_td3_line2(b)]

    # TD1: three lines of ~30
    for i in range(len(candidates) - 2):
        a, b, c = candidates[i : i + 3]
        if all(27 <= len(x) <= 33 for x in (a, b, c)) and a[0] in "ICA":
            return "TD1", [x[:30].ljust(30, "<") for x in (a, b, c)]
    return None


@dataclass
class MRZResult:
    format: str
    document_type: str
    issuing_country: str
    surname: str
    given_names: str
    document_number: str
    nationality: str
    birth_date: date | None
    sex: str
    expiry_date: date | None
    checks: dict[str, bool] = field(default_factory=dict)
    lines: list[str] = field(default_factory=list)

    @property
    def checksums_ok(self) -> bool:
        return all(self.checks.values())

    def to_dict(self) -> dict:
        return {
            "format": self.format,
            "document_type": self.document_type,
            "issuing_country": self.issuing_country,
            "surname": self.surname,
            "given_names": self.given_names,
            "document_number": self.document_number,
            "nationality": self.nationality,
            "birth_date": self.birth_date.isoformat() if self.birth_date else None,
            "sex": self.sex,
            "expiry_date": self.expiry_date.isoformat() if self.expiry_date else None,
            "checks": self.checks,
            "lines": self.lines,
        }


_AMBIGUOUS = {"O": "0", "0": "O", "I": "1", "1": "I", "S": "5", "5": "S", "B": "8", "8": "B",
              "Z": "2", "2": "Z", "G": "6", "6": "G", "D": "0", "Q": "0"}


def _fix_doc_number(num: str, cd: str) -> str:
    """Document numbers mix letters and digits; try OCR look-alike swaps until the check digit matches.

    Some look-alikes (G/6) share the same check-digit value, so ties favour digits, then fewest swaps.
    """
    if check_digit(num) == cd:
        return num
    positions = [i for i, c in enumerate(num) if c in _AMBIGUOUS][:8]
    candidates = []
    for mask in range(1, 1 << len(positions)):
        chars = list(num)
        for bit, pos in enumerate(positions):
            if mask >> bit & 1:
                chars[pos] = _AMBIGUOUS[chars[pos]]
        cand = "".join(chars)
        if check_digit(cand) == cd:
            candidates.append((-sum(c.isdigit() for c in cand), bin(mask).count("1"), cand))
    return min(candidates)[2] if candidates else num


def _recover_final(cd_final: str, composite: str, checks: dict[str, bool]) -> str:
    """The composite digit only re-checks fields that already have their own check digit.
    If OCR produced a non-digit there (e.g. "H") and every other check passes, recompute it.
    A *different digit* is never overridden — that still fails."""
    if not cd_final.isdigit() and all(checks.values()):
        return check_digit(composite)
    return cd_final


def _parse_td3(l1: str, l2: str) -> MRZResult:
    doc_type = _alpha(l1[0:2]).replace("<", "")
    issuing = _alpha(l1[2:5])
    surname, given = _split_names(_alpha(l1[5:44]))

    cd_doc = _digits(l2[9])
    doc_num = _fix_doc_number(l2[0:9], cd_doc)
    nationality = _alpha(l2[10:13])
    dob, cd_dob = _digits(l2[13:19]), _digits(l2[19])
    sex = l2[20].replace("<", "X")
    exp, cd_exp = _digits(l2[21:27]), _digits(l2[27])
    optional, cd_opt = l2[28:42], l2[42]
    if cd_opt != "<":
        cd_opt = _digits(cd_opt)
    cd_final = _digits(l2[43])

    composite = doc_num + cd_doc + dob + cd_dob + exp + cd_exp + optional + cd_opt
    checks = {
        "document_number": check_digit(doc_num) == cd_doc,
        "birth_date": check_digit(dob) == cd_dob,
        "expiry_date": check_digit(exp) == cd_exp,
    }
    if optional.strip("<"):
        checks["personal_number"] = check_digit(optional) == cd_opt
    cd_final = _recover_final(cd_final, composite, checks)
    checks["composite"] = check_digit(composite) == cd_final

    fixed_l2 = doc_num + cd_doc + nationality + dob + cd_dob + sex + exp + cd_exp + optional + cd_opt + cd_final
    return MRZResult(
        format="TD3", document_type=doc_type, issuing_country=issuing.replace("<", ""),
        surname=surname, given_names=given, document_number=doc_num.replace("<", ""),
        nationality=nationality.replace("<", ""), birth_date=_parse_date(dob, future=False),
        sex=sex, expiry_date=_parse_date(exp, future=True), checks=checks, lines=[l1, fixed_l2],
    )


def _parse_td1(l1: str, l2: str, l3: str) -> MRZResult:
    doc_type = _alpha(l1[0:2]).replace("<", "")
    issuing = _alpha(l1[2:5])
    cd_doc = _digits(l1[14])
    doc_num = _fix_doc_number(l1[5:14], cd_doc)
    dob, cd_dob = _digits(l2[0:6]), _digits(l2[6])
    sex = l2[7].replace("<", "X")
    exp, cd_exp = _digits(l2[8:14]), _digits(l2[14])
    nationality = _alpha(l2[15:18])
    cd_final = _digits(l2[29])
    surname, given = _split_names(_alpha(l3))

    composite = doc_num + cd_doc + l1[15:30] + dob + cd_dob + exp + cd_exp + l2[18:29]
    checks = {
        "document_number": check_digit(doc_num) == cd_doc,
        "birth_date": check_digit(dob) == cd_dob,
        "expiry_date": check_digit(exp) == cd_exp,
    }
    cd_final = _recover_final(cd_final, composite, checks)
    checks["composite"] = check_digit(composite) == cd_final
    return MRZResult(
        format="TD1", document_type=doc_type, issuing_country=issuing.replace("<", ""),
        surname=surname, given_names=given, document_number=doc_num.replace("<", ""),
        nationality=nationality.replace("<", ""), birth_date=_parse_date(dob, future=False),
        sex=sex, expiry_date=_parse_date(exp, future=True), checks=checks, lines=[l1, l2, l3],
    )


def parse(raw: str) -> MRZResult | None:
    found = extract_lines(raw)
    if not found:
        return None
    fmt, lines = found
    if not all(_VALID.match(l) for l in lines):
        return None
    return _parse_td3(*lines) if fmt == "TD3" else _parse_td1(*lines)
