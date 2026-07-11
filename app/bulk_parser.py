"""
bulk_parser.py
Universal table parser for the Bulk MPOS Upload feature.
Supports: image (jpg/png/webp), PDF, Excel (.xlsx/.xls), CSV, plain text/markdown paste.
"""
import io
import re
import os
import logging
import tempfile
from dataclasses import dataclass, field
from typing import Optional, List, Dict
from datetime import datetime

logger = logging.getLogger(__name__)

# Symbols treated as "unclear/unreadable" - skip this specific position only
UNCLEAR_SYMBOLS = {
    "○", "◯", "⊙", "●", "–", "—", "?", "N/A", "n/a", "NA", "na", "-"
}

SHIFT_LABEL_MAP = {
    "NIGHT": "NIGHT", "DAY": "DAY", "MORNING": "MORNING",
    "AFTERNOON": "AFTERNOON", "EVENING": "EVENING",
    "DAWN": "MORNING", "AM": "MORNING", "PM": "AFTERNOON",
}

# All valid MPOS position names
KNOWN_POSITIONS = ["L1", "L2", "L3", "L4", "R1", "R2", "R3", "R4", "STDBY1", "STDBY2"]

# Indian airport station codes for dropdown
INDIAN_STATIONS = [
    "DEL", "BOM", "BLR", "HYD", "MAA", "CCU", "AMD", "COK", "PNQ",
    "GOI", "JAI", "LKO", "ATQ", "IXC", "BBI", "NAG", "VTZ", "GAU", "TRV",
]


@dataclass
class ParsedRow:
    sno: Optional[int]
    flight_no: Optional[str]
    # None = UNCLEAR (skip this position), "" = blank (send empty to clear), "12345" = valid
    positions: Dict[str, Optional[str]]
    skip_reason: Optional[str]  # "all_empty" | "no_flight_no" | None


@dataclass
class ParsedTable:
    shift_date: Optional[str]       # ISO-8601: "2026-06-04"
    shift_label: Optional[str]      # "NIGHT" | "DAY" | etc.
    raw_header: Optional[str]
    rows: List[ParsedRow]
    source_format: str
    parse_warnings: List[str]


# ---------------------------------------------------------------------------
# Cell normalisation
# ---------------------------------------------------------------------------

def _normalize_cell(val) -> Optional[str]:
    """
    None  → UNCLEAR symbol, skip this position
    ""    → intentionally blank, send empty to portal (clear allocation)
    "12345" → valid 4-6 digit asset number
    """
    if val is None:
        return ""

    # If numeric float/int, convert to standard integer first
    if isinstance(val, (int, float)):
        import math
        if math.isnan(val):
            return ""
        val = int(val)

    s = str(val).strip()
    if not s or s.lower() in ("nan", "none", ""):
        return ""

    # Clean any trailing .0 suffix
    if s.endswith('.0'):
        prefix = s[:-2]
        if prefix.isdigit():
            s = prefix

    if s in UNCLEAR_SYMBOLS or (len(s) == 1 and s in "○◯⊙●Oo"):
        return None  # UNCLEAR
    if re.match(r"^\d{4,6}$", s):
        return s
    # Non-digit non-empty non-known-symbol → treat as UNCLEAR
    return None



def _normalize_position_col(col: str) -> Optional[str]:
    col = str(col).strip().upper()
    for pos in KNOWN_POSITIONS:
        if col == pos.upper():
            return pos.upper()
    m = re.match(r"STD?B?Y\s*(\d+)", col, re.IGNORECASE)
    if m:
        return f"STDBY{m.group(1)}"
    return None


# ---------------------------------------------------------------------------
# Header parsing
# ---------------------------------------------------------------------------

def _parse_header(text: str):
    """
    Extract (date_iso, shift_label, raw_header) from a header like:
    "04.06.2026 MPOS ALLOCATION NIGHT SHIFT"
    """
    text = str(text).strip()
    shift_date = None
    m = re.search(r"(\d{2})\.(\d{2})\.(\d{4})", text)
    if m:
        day, month, year = m.groups()
        try:
            shift_date = datetime(int(year), int(month), int(day)).strftime("%Y-%m-%d")
        except ValueError:
            pass

    shift_label = None
    for label in SHIFT_LABEL_MAP:
        if re.search(rf"\b{label}\b", text, re.IGNORECASE):
            shift_label = SHIFT_LABEL_MAP[label]
            break

    return shift_date, shift_label, text


# ---------------------------------------------------------------------------
# DataFrame → ParsedRow list
# ---------------------------------------------------------------------------

def _df_to_rows(df, source_format: str, parse_warnings: List[str]) -> List[ParsedRow]:
    import pandas as pd

    cols = [str(c).strip() for c in df.columns]

    # Locate SNO column
    sno_col = next(
        (df.columns[i] for i, c in enumerate(cols)
         if re.match(r"S\.?N\.?O\.?|SNO|#", c, re.IGNORECASE)), None
    )
    # Locate Flight No column
    flt_col = next(
        (df.columns[i] for i, c in enumerate(cols)
         if re.match(r"FLIGHT\s*N[Oo]\.?|FLT\s*NO\.?|FLIGHT", c, re.IGNORECASE)), None
    )
    # Locate position columns
    pos_cols: Dict[str, object] = {}
    for i, c in enumerate(cols):
        norm = _normalize_position_col(c)
        if norm:
            pos_cols[norm] = df.columns[i]

    if not flt_col:
        parse_warnings.append(f"Could not identify 'Flight No' column. Columns: {cols}")

    rows: List[ParsedRow] = []
    for _, row in df.iterrows():
        # SNO
        sno = None
        if sno_col is not None:
            try:
                v = str(row[sno_col]).strip()
                if v and v not in ("nan", "None"):
                    sno = int(float(v))
            except (ValueError, TypeError):
                pass

        # Flight number
        flight_no = None
        if flt_col is not None:
            raw_val = row[flt_col]
            if raw_val is not None:
                if isinstance(raw_val, (int, float)):
                    import math
                    if not math.isnan(raw_val):
                        flight_no = str(int(raw_val))
                else:
                    raw = str(raw_val).strip()
                    if raw and raw not in ("nan", "None"):
                        if raw.endswith('.0'):
                            prefix = raw[:-2]
                            if prefix.isdigit():
                                raw = prefix
                        digits = re.sub(r"\D", "", raw)
                        if digits:
                            flight_no = digits

        if not flight_no:
            continue  # skip rows with no flight number

        # Positions
        positions: Dict[str, Optional[str]] = {}
        for pos_name, col_key in pos_cols.items():
            raw_val = row[col_key] if col_key in row.index else None
            cell = _normalize_cell(raw_val)
            positions[pos_name] = cell
            if cell is None:
                parse_warnings.append(
                    f"Row {sno or '?'}, {pos_name}: unclear symbol detected — position will be skipped"
                )

        # Skip logic:
        # If ALL positions are empty ("") AND None-count == 0 → all_empty → skip flight
        # If at least one valid value exists → process (send empty for the rest to clear portal)
        all_blank = all(v == "" or v is None for v in positions.values())
        has_valid = any(v and v.strip() for v in positions.values() if v is not None)

        skip_reason = "all_empty" if all_blank else None

        rows.append(ParsedRow(
            sno=sno, flight_no=flight_no,
            positions=positions, skip_reason=skip_reason
        ))

    return rows


# ---------------------------------------------------------------------------
# Format-specific parsers
# ---------------------------------------------------------------------------

def parse_text_table(text: str) -> ParsedTable:
    """Parse a markdown/plain-text table pasted by the user."""
    import pandas as pd
    parse_warnings: List[str] = []
    lines = text.strip().splitlines()

    shift_date = shift_label = raw_header = None
    table_lines: List[str] = []

    for line in lines:
        s = line.strip()
        if not s:
            continue
        if re.search(r"\d{2}\.\d{2}\.\d{4}", s) and "|" not in s:
            shift_date, shift_label, raw_header = _parse_header(s)
        elif "|" in s:
            table_lines.append(s)

    if not table_lines:
        return ParsedTable(shift_date, shift_label, raw_header, [], "text",
                           parse_warnings + ["No pipe-delimited table found in pasted text."])

    header = [c.strip() for c in table_lines[0].strip("|").split("|")]
    data_start = 1
    if len(table_lines) > 1 and re.match(r"[\s|:\-]+$", table_lines[1].replace("|", "")):
        data_start = 2

    records = []
    for line in table_lines[data_start:]:
        cells = [c.strip() for c in line.strip("|").split("|")]
        while len(cells) < len(header):
            cells.append("")
        records.append(dict(zip(header, cells[:len(header)])))

    if not records:
        return ParsedTable(shift_date, shift_label, raw_header, [], "text",
                           parse_warnings + ["No data rows in table."])

    df = pd.DataFrame(records)
    rows = _df_to_rows(df, "text", parse_warnings)
    return ParsedTable(shift_date, shift_label, raw_header, rows, "text", parse_warnings)


def parse_csv_file(file_bytes: bytes) -> ParsedTable:
    import pandas as pd
    parse_warnings: List[str] = []
    try:
        df = pd.read_csv(io.BytesIO(file_bytes))
    except Exception as e:
        return ParsedTable(None, None, None, [], "csv", [f"Failed to read CSV: {e}"])
    rows = _df_to_rows(df, "csv", parse_warnings)
    return ParsedTable(None, None, None, rows, "csv", parse_warnings)


def parse_excel_file(file_bytes: bytes) -> ParsedTable:
    import pandas as pd
    parse_warnings: List[str] = []
    try:
        xl = pd.ExcelFile(io.BytesIO(file_bytes))
    except Exception as e:
        return ParsedTable(None, None, None, [], "excel", [f"Failed to open Excel: {e}"])

    shift_date = shift_label = raw_header = None
    best_df = None

    for sheet in xl.sheet_names:
        try:
            raw = pd.read_excel(xl, sheet_name=sheet, header=None)
            # Scan for date header in first 5 rows
            for i in range(min(5, len(raw))):
                row_text = " ".join(str(v) for v in raw.iloc[i] if str(v) != "nan")
                if re.search(r"\d{2}\.\d{2}\.\d{4}", row_text):
                    shift_date, shift_label, raw_header = _parse_header(row_text)
                    break
            # Find actual table header row
            header_idx = None
            for i in range(min(10, len(raw))):
                row_text = " ".join(str(v).upper() for v in raw.iloc[i])
                if re.search(r"FLIGHT|FLT|SNO", row_text):
                    header_idx = i
                    break
            if header_idx is not None:
                best_df = pd.read_excel(xl, sheet_name=sheet, header=header_idx)
                break
        except Exception as e:
            parse_warnings.append(f"Sheet '{sheet}': {e}")

    if best_df is None:
        return ParsedTable(shift_date, shift_label, raw_header, [], "excel",
                           parse_warnings + ["Could not find a valid flight table in the Excel file."])

    rows = _df_to_rows(best_df, "excel", parse_warnings)
    return ParsedTable(shift_date, shift_label, raw_header, rows, "excel", parse_warnings)


def parse_image_file(file_bytes: bytes, ext: str) -> ParsedTable:
    parse_warnings: List[str] = []
    try:
        from img2table.document import Image as Img2Image
        from img2table.ocr import PaddleOCR as Img2Paddle
    except ImportError:
        return ParsedTable(None, None, None, [], "image",
                           ["img2table/paddleocr not installed. Run: pip install img2table paddleocr paddlepaddle"])
    try:
        import pandas as pd
        ocr = Img2Paddle(lang="en")
        with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        try:
            doc = Img2Image(tmp_path, detect_rotation=True)
            extracted = doc.extract_tables(ocr=ocr, implicit_rows=True, borderless_tables=True)
        finally:
            os.unlink(tmp_path)
        if not extracted:
            return ParsedTable(None, None, None, [], "image", ["No tables detected in image."])
        table = max(extracted, key=lambda t: t.df.shape[0] if hasattr(t, "df") else 0)
        df = table.df
        if all(isinstance(c, int) for c in df.columns):
            df.columns = df.iloc[0]
            df = df[1:].reset_index(drop=True)
        rows = _df_to_rows(df, "image", parse_warnings)
        return ParsedTable(None, None, None, rows, "image", parse_warnings)
    except Exception as e:
        logger.error(f"Image parse error: {e}")
        return ParsedTable(None, None, None, [], "image", [f"Image parsing failed: {e}"])


def parse_pdf_file(file_bytes: bytes) -> ParsedTable:
    parse_warnings: List[str] = []
    try:
        from img2table.document import PDF as Img2PDF
        from img2table.ocr import PaddleOCR as Img2Paddle
    except ImportError:
        return ParsedTable(None, None, None, [], "pdf",
                           ["img2table/paddleocr not installed. Run: pip install img2table paddleocr paddlepaddle"])
    try:
        import pandas as pd
        ocr = Img2Paddle(lang="en")
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        try:
            doc = Img2PDF(tmp_path, detect_rotation=True)
            extracted_dict = doc.extract_tables(ocr=ocr, implicit_rows=True, borderless_tables=True)
        finally:
            os.unlink(tmp_path)
        all_tables = [t for page in extracted_dict.values() for t in page]
        if not all_tables:
            return ParsedTable(None, None, None, [], "pdf", ["No tables detected in PDF."])
        table = max(all_tables, key=lambda t: t.df.shape[0] if hasattr(t, "df") else 0)
        df = table.df
        if all(isinstance(c, int) for c in df.columns):
            df.columns = df.iloc[0]
            df = df[1:].reset_index(drop=True)
        rows = _df_to_rows(df, "pdf", parse_warnings)
        return ParsedTable(None, None, None, rows, "pdf", parse_warnings)
    except Exception as e:
        logger.error(f"PDF parse error: {e}")
        return ParsedTable(None, None, None, [], "pdf", [f"PDF parsing failed: {e}"])


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def parse_upload(file_bytes: bytes, filename: str) -> ParsedTable:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in ("jpg", "jpeg", "png", "webp"):
        return parse_image_file(file_bytes, ext)
    elif ext == "pdf":
        return parse_pdf_file(file_bytes)
    elif ext in ("xlsx", "xls"):
        return parse_excel_file(file_bytes)
    elif ext == "csv":
        return parse_csv_file(file_bytes)
    else:
        try:
            return parse_text_table(file_bytes.decode("utf-8", errors="replace"))
        except Exception as e:
            return ParsedTable(None, None, None, [], "unknown", [f"Unsupported format '{ext}': {e}"])
