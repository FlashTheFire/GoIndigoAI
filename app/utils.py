import uuid
import logging

def generate_request_id() -> str:
    """Generates a unique ID for request tracking."""
    return str(uuid.uuid4())

class RequestIdFilter(logging.Filter):
    """Injects request_id into logs."""
    def __init__(self, request_id: str):
        super().__init__()
        self.request_id = request_id

    def filter(self, record):
        record.request_id = self.request_id
        return True


def normalize_to_portal_date(date_str: str) -> str:
    """
    Normalizes any date string (favoring DD/MM/YYYY and DD-MM-YYYY first)
    to the MM/DD/YYYY format expected by the Indigo Portal API.
    """
    from datetime import datetime
    date_str = date_str.strip()
    
    # Check if we have time component (like 2026-06-05T00:00:00)
    if "T" in date_str:
        date_str = date_str.split("T")[0]
        
    # Order of format parsing:
    # 1. Favor DD-based formats (DD/MM/YYYY, DD-MM-YYYY)
    # 2. ISO format (YYYY-MM-DD)
    # 3. Fallbacks (MM/DD/YYYY, MM-DD-YYYY)
    formats = [
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%m-%d-%Y"
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.strftime("%m/%d/%Y")
        except ValueError:
            continue
            
    return date_str


def normalize_to_local_date_slash(date_str: str) -> str:
    """Normalizes any date string to DD/MM/YYYY format."""
    from datetime import datetime
    date_str = date_str.strip()
    if "T" in date_str:
        date_str = date_str.split("T")[0]
        
    formats = [
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%m-%d-%Y"
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.strftime("%d/%m/%Y")
        except ValueError:
            continue
    return date_str


def normalize_to_local_date_dash(date_str: str) -> str:
    """Normalizes any date string to DD-MM-YYYY format."""
    from datetime import datetime
    date_str = date_str.strip()
    if "T" in date_str:
        date_str = date_str.split("T")[0]
        
    formats = [
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%m-%d-%Y"
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.strftime("%d-%m-%Y")
        except ValueError:
            continue
    return date_str

