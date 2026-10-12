"""CSV parsing and automatic column mapping. Pure functions, no database access."""

import csv
import hashlib
import io
from dataclasses import dataclass

from .schema import ALIASES, FIELDS, norm


@dataclass
class ParsedCsv:
    header: list[str]
    records: list[tuple[int, list[str]]]  # (line number where the record starts, cells); header is line 1
    error: str | None


def file_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def parse_csv(text: str) -> ParsedCsv:
    """RFC 4180-style: quoted fields, escaped quotes, CRLF, newlines inside quotes. Blank lines are skipped."""
    src = text[1:] if text.startswith("﻿") else text
    reader = csv.reader(io.StringIO(src, newline=""), strict=True)
    rows: list[tuple[int, list[str]]] = []
    prev_end = 0
    try:
        for cells in reader:
            start = prev_end + 1
            prev_end = reader.line_num
            if not cells or (len(cells) == 1 and not cells[0].strip()):
                continue
            rows.append((start, cells))
    except csv.Error as e:
        return ParsedCsv([], [], f"The file could not be parsed near line {reader.line_num}: {e}.")
    if not rows:
        return ParsedCsv([], [], None)
    header = [h.strip() for h in rows[0][1]]
    return ParsedCsv(header, rows[1:], None)


def auto_map(header: list[str]) -> dict[str, str | None]:
    """Schema field → column. Exact field names first, then known aliases; each column is used once."""
    mapping: dict[str, str | None] = {f: None for f in FIELDS}
    used: set[str] = set()
    for exact in (True, False):
        for field in FIELDS:
            if mapping[field]:
                continue
            names = {norm(field)} if exact else ALIASES[field]
            col = next((h for h in header if h and h not in used and norm(h) in names), None)
            if col:
                mapping[field] = col
                used.add(col)
    return mapping
