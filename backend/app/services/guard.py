"""Output guard: last line of defence that redacts PII-looking strings before text reaches a customer."""
import re

EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
PHONE = re.compile(r"(?<![\w-])\+?\d[\d\-\s().]{5,}\d(?!\w)")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _is_phone(s: str) -> bool:
    return len(re.sub(r"\D", "", s)) >= 7 and not ISO_DATE.match(s.strip())
CARD = re.compile(r"\b(?:\d[ -]?){13,19}\b")


def find_pii(text: str) -> list[str]:
    hits = [m.group(0) for m in EMAIL.finditer(text)]
    hits += [m.group(0).strip() for m in CARD.finditer(text)]
    hits += [m.group(0).strip() for m in PHONE.finditer(text) if _is_phone(m.group(0))]
    return hits


def redact_pii(text: str) -> tuple[str, bool]:
    out = EMAIL.sub("[email removed]", text)
    out = CARD.sub("[number removed]", out)
    out = PHONE.sub(lambda m: "[phone removed]" if _is_phone(m.group(0)) else m.group(0), out)
    return out, out != text
