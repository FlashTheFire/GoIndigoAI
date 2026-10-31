import os
import csv
import logging
import asyncio
import collections
import random
import re
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query, UploadFile, File, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import settings
from .http_client import APIClient
from .workflow import process_flight_data

logger = logging.getLogger(__name__)

# --- Log Buffer Setup ---
class LogBufferHandler(logging.Handler):
    def __init__(self, capacity: int = 150):
        super().__init__()
        self.buffer = collections.deque(maxlen=capacity)

    def emit(self, record):
        try:
            msg = self.format(record)
            self.buffer.append(msg)
        except Exception:
            self.handleError(record)

    def get_logs(self) -> List[str]:
        return list(self.buffer)

log_buffer = LogBufferHandler()
log_buffer.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s - %(message)s"))
# Add handler to root logger
logging.getLogger().addHandler(log_buffer)


# --- Web Models ---
class SettingsUpdate(BaseModel):
    poll_interval_seconds: int
    dry_run: bool
    auth_cookie_copsweb02: str
    auth_cookie_copsweb021: str
    auth_cookie_session: str
    log_level: str

class TriggerRequest(BaseModel):
    date: str  # MM/DD/YYYY format




# --- Global Scheduler State ---
class SchedulerState:
    def __init__(self):
        self.active: bool = True
        self.last_run: Optional[datetime] = None
        self.next_run: Optional[datetime] = None
        self.is_running_job: bool = False
        self.task: Optional[asyncio.Task] = None
        self.keep_alive_task: Optional[asyncio.Task] = None

scheduler_state = SchedulerState()


# --- Worker Job ---
def run_scheduler_job():
    """Runs the flight data fetching job synchronously."""
    logger.info("Scheduler starting background flight data sync...")
    client = APIClient()
    try:
        # Use current date
        target_date = datetime.now().strftime("%d/%m/%Y")
        process_flight_data(client, target_date)
        logger.info("Scheduler completed flight data sync successfully.")
    except Exception as e:
        logger.error(f"Scheduler job failed with error: {e}")
    finally:
        client.close()


async def scheduler_loop():
    """Async scheduler loop that respects settings and control states."""
    global scheduler_state
    logger.info("Background scheduler task loop started.")
    
    # Run immediately on startup
    if scheduler_state.active:
        scheduler_state.is_running_job = True
        try:
            await asyncio.to_thread(run_scheduler_job)
        except Exception as e:
            logger.error(f"Startup job failed: {e}")
        finally:
            scheduler_state.is_running_job = False
            scheduler_state.last_run = datetime.now()

    while True:
        try:
            if not scheduler_state.active:
                scheduler_state.next_run = None
                await asyncio.sleep(1)
                continue

            interval = max(5, settings.poll_interval_seconds) # minimum 5 seconds safety limit
            scheduler_state.next_run = datetime.now() + timedelta(seconds=interval)

            # Sleep in 1-second chunks to react quickly to toggles or changes
            for _ in range(interval):
                if not scheduler_state.active:
                    break
                await asyncio.sleep(1)

            if not scheduler_state.active:
                continue

            scheduler_state.is_running_job = True
            scheduler_state.next_run = datetime.now() + timedelta(seconds=interval)
            try:
                await asyncio.to_thread(run_scheduler_job)
            except Exception as e:
                logger.error(f"Scheduled job failed: {e}")
            finally:
                scheduler_state.is_running_job = False
                scheduler_state.last_run = datetime.now()

        except asyncio.CancelledError:
            logger.info("Scheduler loop task cancelled.")
            break
        except Exception as e:
            logger.error(f"Error in scheduler loop: {e}")
            await asyncio.sleep(10)


# --- Helper Functions ---
def get_csv_files() -> List[Dict[str, Any]]:
    """Lists all flight CSV files in the workspace directory."""
    files = []
    for entry in os.scandir("."):
        if entry.is_file() and entry.name.startswith("DEL_Flights_") and entry.name.endswith(".csv"):
            stat = entry.stat()
            # Extract date from name: e.g. DEL_Flights_05-14-2026.csv -> 05-14-2026
            date_str = entry.name.replace("DEL_Flights_", "").replace(".csv", "")
            files.append({
                "filename": entry.name,
                "date": date_str,
                "size_bytes": stat.st_size,
                "modified_time": datetime.fromtimestamp(stat.st_mtime).isoformat()
            })
    # Sort files by modified time descending (newest first)
    files.sort(key=lambda x: x["modified_time"], reverse=True)
    return files


def parse_csv_flights(filename: str) -> List[Dict[str, Any]]:
    """Parses a flight CSV file into list of dicts for JSON representation."""
    flights = []
    if not os.scandir(".") or not os.path.exists(filename):
        return flights
        
    # Try to extract date from filename (e.g. DEL_Flights_06-04-2026.csv -> 04/06/2026)
    date_fallback = ""
    try:
        base = os.path.basename(filename)
        # DEL_Flights_DD-MM-YYYY.csv
        parts = base.replace("DEL_Flights_", "").replace(".csv", "").split("-")
        if len(parts) == 3:
            # target date in filename is DD-MM-YYYY, convert to DD/MM/YYYY
            date_fallback = f"{parts[0]}/{parts[1]}/{parts[2]}"
    except Exception:
        pass

    try:
        from app.models import AIRCRAFT_TYPE_MAP
        with open(filename, mode='r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Reverse mapping helper for AircraftType fallback if missing
                aircraft_type_id_raw = row.get("AircraftTypeId", "").strip()
                aircraft_type_id = int(aircraft_type_id_raw) if aircraft_type_id_raw else None
                reverse_aircraft_map = {v: k for k, v in AIRCRAFT_TYPE_MAP.items()}
                aircraft_type_fallback = reverse_aircraft_map.get(aircraft_type_id, "") if aircraft_type_id else ""

                flights.append({
                    "flt_no": row.get("Flight No", ""),
                    "dep": row.get("Departure", ""),
                    "arr": row.get("Arrival", ""),
                    "seq": row.get("Seq.", ""),
                    "flight_type": row.get("Flight Type", ""),
                    "is_top_up": row.get("Is Top Up", ""),
                    "caterer_code": row.get("Caterer Code", ""),
                    "category": row.get("Category", ""),
                    "aircraft_type_id": aircraft_type_id,
                    "route_no": row.get("Route No") or row.get("RouteNo") or "",
                    "aircraft_type": row.get("Aircraft Type") or row.get("AircraftType") or aircraft_type_fallback or "",
                    "flt_dt": row.get("Flt Dt") or row.get("Flt_Dt") or date_fallback or "",
                    "std": row.get("STD") or row.get("std") or "",
                    "sta": row.get("STA") or row.get("sta") or "",
                    "carts": row.get("Carts", ""),
                    "drawers": row.get("Drawers", "")
                })
    except Exception as e:
        logger.error(f"Failed to parse CSV file {filename}: {e}")
    return flights


async def session_keep_alive_loop():
    """Background task to periodically ping the Indigo portal to prevent session cookie expiration."""
    logger.info("Session Keep-Alive background loop started.")
    consecutive_failures = 0
    base_interval = getattr(settings, "keep_alive_interval_seconds", 180)
    
    while True:
        try:
            # Only run if we have some cookies configured
            if settings.auth_cookie_copsweb02 and settings.auth_cookie_session:
                client = APIClient()
                try:
                    logger.info("Sending session keep-alive ping to Indigo portal...")
                    timestamp = str(int(datetime.now().timestamp() * 1000))
                    target_date = datetime.now().strftime("%d/%m/%Y")
                    # Trigger light query
                    client.get_flight_information(
                        date=target_date,
                        dep="DEL",
                        is_base_flight=True,
                        timestamp=timestamp,
                        aircraft_id=0,
                        terminal=0
                    )
                    logger.info("Session keep-alive ping successful. ASP.NET session extended.")
                    consecutive_failures = 0
                except Exception as ex:
                    consecutive_failures += 1
                    if consecutive_failures >= 3:
                        logger.error(
                            f"CRITICAL: Session keep-alive ping failed {consecutive_failures} times consecutively. "
                            f"Session is likely expired or portal is unreachable. Error: {ex}"
                        )
                    else:
                        logger.warning(
                            f"Session keep-alive ping failed (attempt {consecutive_failures}): {ex}"
                        )
                finally:
                    client.close()
            else:
                logger.debug("No active auth cookies to perform session keep-alive ping.")
        except asyncio.CancelledError:
            logger.info("Session keep-alive task cancelled. Shutting down gracefully...")
            raise
        except Exception as e:
            logger.error(f"Error in session keep-alive loop: {e}")
        
        # Jitter between -10 and 10 seconds to avoid strict patterns
        jitter = random.randint(-10, 10)
        delay = max(10, base_interval + jitter)
        
        # Exponential backoff up to 10 minutes if we have consecutive errors
        if consecutive_failures > 0:
            backoff = min(600, 30 * (2 ** (consecutive_failures - 1)))
            delay = max(delay, backoff)
            logger.info(f"Keep-alive retry scheduled in {delay} seconds (with backoff).")
            
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            logger.info("Session keep-alive task cancelled during sleep. Shutting down gracefully...")
            raise


# --- FastAPI App initialization ---
app = FastAPI(
    title="GoIndigo Automation Console",
    description="Operational control dashboard and live status monitor."
)

# CORS configuration with local network regex
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://localhost(:\d+)?$|^http://127\.0\.0\.1(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom middleware to inject Private Network Access headers for modern Chrome
@app.middleware("http")
async def add_pna_header(request, call_next):
    is_pna = (
        request.headers.get("access-control-request-private-network") == "true" or
        "Access-Control-Request-Private-Network" in request.headers
    )
    response = await call_next(request)
    if is_pna:
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

# Startup & Shutdown events
@app.on_event("startup")
async def startup_event():
    # Start background scheduler loop
    scheduler_state.task = asyncio.create_task(scheduler_loop())
    # Start background keep-alive loop
    scheduler_state.keep_alive_task = asyncio.create_task(session_keep_alive_loop())

@app.on_event("shutdown")
async def shutdown_event():
    if scheduler_state.task:
        scheduler_state.task.cancel()
        try:
            await scheduler_state.task
        except asyncio.CancelledError:
            pass
            
    if scheduler_state.keep_alive_task:
        scheduler_state.keep_alive_task.cancel()
        try:
            await scheduler_state.keep_alive_task
        except asyncio.CancelledError:
            pass


# --- API Endpoints ---

@app.get("/api/status")
def get_status():
    """Returns the current state of the application and scheduler."""
    # Check if auth cookies are configured
    cookies_set = {
        "COPSWeb02": bool(settings.auth_cookie_copsweb02),
        "COPSWeb021": bool(settings.auth_cookie_copsweb021),
        "ASP.NET_SessionId": bool(settings.auth_cookie_session)
    }
    
    return {
        "scheduler": {
            "active": scheduler_state.active,
            "is_running_job": scheduler_state.is_running_job,
            "last_run": scheduler_state.last_run.isoformat() if scheduler_state.last_run else None,
            "next_run": scheduler_state.next_run.isoformat() if scheduler_state.next_run else None,
            "poll_interval_seconds": settings.poll_interval_seconds
        },
        "config": {
            "dry_run": settings.dry_run,
            "log_level": settings.log_level,
            "api_base_url": settings.api_base_url,
            "cookies_configured": cookies_set
        },
        "system_time": datetime.now().isoformat()
    }


@app.post("/api/scheduler/toggle")
def toggle_scheduler(active: bool):
    """Start or stop the background scheduler."""
    scheduler_state.active = active
    logger.info(f"Scheduler state toggled to: {'ACTIVE' if active else 'INACTIVE'}")
    return {"status": "success", "active": scheduler_state.active}


@app.post("/api/settings")
def update_settings(payload: SettingsUpdate):
    """Updates settings in memory and persists them to the .env file."""
    try:
        # Update app settings in memory
        settings.poll_interval_seconds = payload.poll_interval_seconds
        settings.dry_run = payload.dry_run
        settings.auth_cookie_copsweb02 = payload.auth_cookie_copsweb02
        settings.auth_cookie_copsweb021 = payload.auth_cookie_copsweb021
        settings.auth_cookie_session = payload.auth_cookie_session
        settings.log_level = payload.log_level

        # Persist to .env file
        settings.save_to_env()
        
        # Apply logging level changes dynamically
        logging.getLogger().setLevel(getattr(logging, settings.log_level.upper(), logging.INFO))
        
        logger.info("Application settings updated and persisted successfully.")
        return {"status": "success", "message": "Settings updated and saved to .env"}
    except Exception as e:
        logger.error(f"Failed to save settings: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def validate_cookie_format(name: str, value: str):
    if not value:
        return
    value_len = len(value)
    if name == "ASP.NET_SessionId":
        # Usually 24 chars, let's allow 15 to 48 chars of alphanumeric and dashes
        if not re.match(r"^[a-zA-Z0-9\-]{15,48}$", value):
            raise HTTPException(status_code=400, detail=f"Invalid format for {name}.")
    elif name in ("COPSWeb02", "COPSWeb021"):
        # Very long base64/XML-like string.
        # Allow alphanumeric, +, /, =, -, _, %, and spaces (in case of url encoding/decoding variations)
        # Enforce length between 30 and 10000 chars.
        if value_len < 30 or value_len > 10000:
            raise HTTPException(status_code=400, detail=f"Invalid length for {name} ({value_len}).")
        if not re.match(r"^[a-zA-Z0-9\+/=\-_\s%]+$", value):
            raise HTTPException(status_code=400, detail=f"Invalid character in {name}.")





@app.get("/api/settings/raw")
def get_raw_settings():
    """Retrieve settings for editing."""
    return {
        "poll_interval_seconds": settings.poll_interval_seconds,
        "dry_run": settings.dry_run,
        "auth_cookie_copsweb02": settings.auth_cookie_copsweb02,
        "auth_cookie_copsweb021": settings.auth_cookie_copsweb021,
        "auth_cookie_session": settings.auth_cookie_session,
        "log_level": settings.log_level
    }


@app.post("/api/trigger")
async def trigger_fetch(payload: TriggerRequest):
    """Manually triggers flight data fetch for a specific date (DD/MM/YYYY)."""
    # Parse date to ensure it is valid
    try:
        dt = datetime.strptime(payload.date, "%d/%m/%Y")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Must be DD/MM/YYYY")

    logger.info(f"Manual flight data fetch triggered for date: {payload.date}")
    
    # Run fetch synchronously to return the results directly to the client
    def task_execution():
        client = APIClient()
        try:
            process_flight_data(client, payload.date)
        finally:
            client.close()

    try:
        await asyncio.to_thread(task_execution)
        # Load the newly created/updated file
        csv_filename = f"DEL_Flights_{payload.date.replace('/', '-')}.csv"
        flights = parse_csv_flights(csv_filename)
        return {
            "status": "success",
            "message": f"Successfully fetched flight data for {payload.date}",
            "filename": csv_filename,
            "flights_count": len(flights),
            "flights": flights
        }
    except Exception as e:
        logger.error(f"Manual trigger failed: {e}")
        raise HTTPException(status_code=500, detail=f"Fetch failed: {str(e)}")


@app.get("/api/csvs")
def list_csvs():
    """List all CSV files generated by the exporter."""
    return {"csv_files": get_csv_files()}


@app.get("/api/csvs/download/{filename}")
def download_csv(filename: str):
    """Downloads a specific flight CSV file."""
    # Safety check to prevent directory traversal
    filename = os.path.basename(filename)
    if not filename.startswith("DEL_Flights_") or not filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Invalid filename format.")
        
    if not os.path.exists(filename):
        raise HTTPException(status_code=404, detail="CSV file not found.")
        
    return FileResponse(path=filename, filename=filename, media_type="text/csv")


@app.get("/api/flights")
def get_flights(filename: Optional[str] = Query(None)):
    """
    Returns flight list. If filename is provided, parses it.
    Otherwise parses the latest available CSV file in the directory.
    """
    if filename:
        filename = os.path.basename(filename)
        if not os.path.exists(filename):
            raise HTTPException(status_code=404, detail="File not found")
        target_file = filename
    else:
        csv_files = get_csv_files()
        if not csv_files:
            return {"filename": None, "flights": []}
        target_file = csv_files[0]["filename"]

    flights = parse_csv_flights(target_file)
    return {
        "filename": target_file,
        "flights": flights
    }


@app.get("/api/logs")
def get_logs():
    """Returns the latest buffered logging lines."""
    return {"logs": log_buffer.get_logs()}



class AssetAllocationItem(BaseModel):
    t_ciid: str
    cart_type: str
    asset_number: str

class UpdateDeviceAllocationPayload(BaseModel):
    flight_number: str
    station: str
    aircraft_type_id: str
    allocations: List[AssetAllocationItem]


def parse_cart_allocation_html(html: str) -> dict:
    import re
    
    row_match = re.search(
        r'<td>(\d{2}/\d{2}/\d{4})</td>\s*<td>(\d+)</td>\s*<td>(\w+)</td>\s*<td>(\w+)</td>\s*<td>(\w+)</td>\s*<td>(\d{2}:\d{2})</td>\s*<td>(\d{2}:\d{2})</td>', 
        html
    )
    if row_match:
        flight_date, flight_no, caterer, dep, arr, std, sta = row_match.groups()
    else:
        flight_date, flight_no, caterer, dep, arr, std, sta = "", "", "", "", "", "", ""
        
    input_tags = re.findall(r'<input[^>]+>', html)
    
    cart_models = {}
    asset_models = {}
    
    for tag in input_tags:
        name_match = re.search(r'name="([^"]+)"', tag)
        value_match = re.search(r'value="([^"]*)"', tag)
        if not name_match:
            continue
        name = name_match.group(1)
        value = value_match.group(1) if value_match else ""
        
        # CartTypeModelList
        cart_match = re.search(r'\[\d+\]\.CartTypeModelList\[(\d+)\]\.(\w+)', name)
        if cart_match:
            idx = int(cart_match.group(1))
            field = cart_match.group(2)
            if idx not in cart_models:
                cart_models[idx] = {}
            cart_models[idx][field] = value
            continue
            
        # AssetTypeModelList
        asset_match = re.search(r'\[\d+\]\.AssetTypeModelList\[(\d+)\]\.(\w+)', name)
        if asset_match:
            idx = int(asset_match.group(1))
            field = asset_match.group(2)
            if idx not in asset_models:
                asset_models[idx] = {}
            asset_models[idx][field] = value
            continue
            
    carts = []
    for idx in sorted(cart_models.keys()):
        model = cart_models[idx]
        if "CartType" in model:
            carts.append({
                "t_ciid": model.get("T_CIId", ""),
                "type": model.get("CartType", ""),
                "cart_id": model.get("M_CartId", ""),
                "received_station": model.get("ReceivedStation", ""),
                "category": "MHS" if "MHS" in model.get("CartType", "") else "FNB"
            })
            
    devices = []
    for idx in sorted(asset_models.keys()):
        model = asset_models[idx]
        if "CartType" in model:
            devices.append({
                "t_ciid": model.get("T_CIId", ""),
                "type": model.get("CartType", ""),
                "asset_id": model.get("AssetId", ""),
                "received_station": model.get("AssetReceiveStation", ""),
                "cart_flag": model.get("CartAllocatedFlag", "")
            })
            
    return {
        "flight_date": flight_date,
        "flight_number": flight_no,
        "caterer": caterer,
        "dep": dep,
        "arr": arr,
        "std": std,
        "sta": sta,
        "carts": carts,
        "devices": devices
    }


@app.get("/api/flights/cart-allocation")
def get_cart_allocation(
    station: str,
    date: str,
    flight_number: str,
    caterer_code: str,
    aircraft_type_id: Optional[int] = None
):
    """Fetches and parses the raw cart allocation state for a specific flight."""
    if settings.dry_run:
        dep, arr, std, sta = "DEL", "BOM", "12:00", "14:00"
        import glob
        csv_files = glob.glob("DEL_Flights_*.csv")
        if csv_files:
            try:
                flights = parse_csv_flights(csv_files[0])
                clean_no = "".join(c for c in flight_number if c.isdigit())
                for f in flights:
                    f_no = "".join(c for c in str(f.get("flt_no", "")) if c.isdigit())
                    if f_no == clean_no:
                        dep = f.get("dep", "DEL")
                        arr = f.get("arr", "BOM")
                        std = f.get("std", "12:00")
                        sta = f.get("sta", "14:00")
                        break
            except Exception:
                pass
        
        positions = ["L1", "L2", "L3", "L4", "R1", "R2", "R3", "R4", "STDBY1", "STDBY2"]
        carts = []
        devices = []
        for i, pos in enumerate(positions):
            carts.append({
                "t_ciid": str(1000 + i),
                "type": pos,
                "cart_id": f"CRT-{pos}-999" if i % 2 == 0 else "",
                "received_station": station,
                "category": "MHS" if "STDBY" in pos or "L" in pos else "FNB"
            })
            devices.append({
                "t_ciid": str(2000 + i),
                "type": pos,
                "asset_id": "",
                "received_station": station,
                "cart_flag": "Y"
            })
            
        return {
            "flight_date": date,
            "flight_number": flight_number,
            "caterer": caterer_code,
            "dep": dep,
            "arr": arr,
            "std": std,
            "sta": sta,
            "carts": carts,
            "devices": devices
        }

    from app.http_client import APIClient
    client = APIClient()
    try:
        html = client.get_cart_allocation_html(
            station=station,
            date=date,
            flight_number=flight_number,
            caterer=caterer_code,
            aircraft_id=aircraft_type_id
        )
        parsed = parse_cart_allocation_html(html)
        if not parsed["flight_number"]:
            parsed["flight_number"] = flight_number
            parsed["station"] = station
            parsed["aircraft_type_id"] = str(aircraft_type_id)
            parsed["caterer"] = caterer_code
        else:
            parsed["station"] = station
            parsed["aircraft_type_id"] = str(aircraft_type_id)
        return parsed
    except Exception as e:
        logger.error(f"Error fetching cart allocations: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        client.close()


@app.post("/api/flights/update-device-allocation")
def update_device_allocation(payload: UpdateDeviceAllocationPayload):
    """Sends device allocation updates to the Indigo portal."""
    if settings.dry_run:
        return {
            "Status": 1,
            "status": "success",
            "message": "Dry run: device allocations updated successfully",
            "updated_allocations": [
                {
                    "t_ciid": item.t_ciid,
                    "cart_type": item.cart_type,
                    "asset_number": item.asset_number
                }
                for item in payload.allocations
            ]
        }

    from app.http_client import APIClient
    client = APIClient()
    try:
        allocations_list = [
            {
                "t_ciid": item.t_ciid,
                "cart_type": item.cart_type,
                "asset_number": item.asset_number
            }
            for item in payload.allocations
        ]
        result = client.update_asset_allocation(
            station=payload.station,
            flight_number=payload.flight_number,
            aircraft_type_id=payload.aircraft_type_id,
            allocations=allocations_list
        )
        return result
    except Exception as e:
        logger.error(f"Failed to update device allocation: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        client.close()


# ---------------------------------------------------------------------------
# Bulk MPOS Upload Endpoints
# ---------------------------------------------------------------------------

class BulkProcessRow(BaseModel):
    sno: Optional[int] = None
    flight_no: Optional[str] = None
    positions: Dict[str, Optional[str]] = {}
    skip_reason: Optional[str] = None

class BulkProcessPayload(BaseModel):
    station: str
    date: str
    shift_label: Optional[str] = None
    rows: List[BulkProcessRow]


@app.post("/api/bulk/parse-file")
async def parse_bulk_file(file: UploadFile = File(...)):
    """Parse an uploaded file (image/PDF/Excel/CSV). Returns structured table JSON."""
    from app.bulk_parser import parse_upload, INDIAN_STATIONS
    import dataclasses
    try:
        file_bytes = await file.read()
        result = parse_upload(file_bytes, file.filename)
        return {
            "shift_date": result.shift_date,
            "shift_label": result.shift_label,
            "raw_header": result.raw_header,
            "source_format": result.source_format,
            "parse_warnings": result.parse_warnings,
            "stations": INDIAN_STATIONS,
            "rows": [dataclasses.asdict(r) for r in result.rows]
        }
    except Exception as e:
        logger.error(f"Bulk parse-file error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class BulkParseTextRequest(BaseModel):
    text: str


@app.post("/api/bulk/parse-text")
async def parse_bulk_text(body: BulkParseTextRequest):
    """Parse a pasted markdown/plain-text table."""
    from app.bulk_parser import parse_text_table, INDIAN_STATIONS
    import dataclasses

    result = parse_text_table(body.text)
    return {
        "shift_date": result.shift_date,
        "shift_label": result.shift_label,
        "raw_header": result.raw_header,
        "source_format": result.source_format,
        "parse_warnings": result.parse_warnings,
        "stations": INDIAN_STATIONS,
        "rows": [dataclasses.asdict(r) for r in result.rows]
    }


@app.post("/api/bulk/process")
async def process_bulk(payload: BulkProcessPayload):
    """
    SSE stream: processes each row sequentially, yields per-flight events.
    """
    from fastapi.responses import StreamingResponse
    from app.bulk_processor import process_bulk_rows

    # Load CSV flights for the given date
    csv_files = get_csv_files()
    target_csv = None
    try:
        dt = datetime.strptime(payload.date, "%Y-%m-%d")
        date_str_filename = dt.strftime("%d-%m-%Y")
    except ValueError:
        date_str_filename = payload.date

    for csv_info in csv_files:
        if date_str_filename in csv_info["filename"]:
            target_csv = csv_info["filename"]
            break
    if not target_csv and csv_files:
        target_csv = csv_files[0]["filename"]

    csv_flights = parse_csv_flights(target_csv) if target_csv else []
    rows_dicts = [r.model_dump() for r in payload.rows]

    async def event_stream():
        if not target_csv:
            import json
            yield f"event: error\ndata: {json.dumps({'message': 'No CSV data found. Sync flight data first.'})}\n\n"
            yield f"event: done\ndata: {{}}\n\n"
            return
        async for chunk in process_bulk_rows(
            rows=rows_dicts,
            station=payload.station,
            date=payload.date,
            shift_label=payload.shift_label,
            csv_flights=csv_flights,
            dry_run=settings.dry_run
        ):
            yield chunk

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# --- Direct Auth Endpoints ---

@app.post("/api/auth/automate")
async def start_auto_auth():
    """Trigger the headed browser automated authentication process."""
    from .auth_automation import automate_authentication
    logger.info("Headed browser cookie extraction triggered via Web API.")
    try:
        # Run in a separate thread to prevent blocking the async event loop
        result = await asyncio.to_thread(automate_authentication)
        if result.get("status") == "success":
            return result
        else:
            raise HTTPException(status_code=400, detail=result.get("message", "Authentication failed"))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Auto auth failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --- Serve Static UI Files ---


# Create static directory if not exists
os.makedirs("static", exist_ok=True)

# Mount the static files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def get_index():
    """Serves the UI landing page."""
    index_path = "static/index.html"
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return JSONResponse(
        content={"error": "UI files not built yet. Access /static/index.html once created."},
        status_code=404
    )
