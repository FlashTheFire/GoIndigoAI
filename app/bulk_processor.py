"""
bulk_processor.py
SSE-streaming processor for Bulk MPOS Upload.
Processes parsed rows sequentially, submits to portal, auto-retries on validation errors.
"""
import json
import re
import logging
import asyncio
from typing import List, Optional, Dict, AsyncIterator

logger = logging.getLogger(__name__)


def _event(event_type: str, data: dict) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"


def _parse_failed_numbers(result: dict) -> List[str]:
    raw = result.get("CartNumbers") or ""
    return [c.strip() for c in raw.split(",") if c.strip()]


def _match_flight(csv_flights: List[dict], flight_no: str, station: str) -> Optional[dict]:
    fno = re.sub(r"\D", "", str(flight_no)).lstrip("0")
    for f in csv_flights:
        csv_fno = re.sub(r"\D", "", str(f.get("Flt_No") or f.get("flight_no") or f.get("flt_no") or "")).lstrip("0")
        csv_dep = str(f.get("Dep") or f.get("dep") or "").strip().upper()
        if csv_fno == fno and csv_dep == station.upper():
            return f
    return None


def _build_allocations(devices: List[dict], positions: Dict[str, Optional[str]]) -> List[dict]:
    """
    Build allocation payload list.
    Skips positions that are None (UNCLEAR).
    Sends empty string to clear positions that are "".
    
    Fallback swap logic for R2 and R4:
    If exactly one of R2 and R4 target is specified, and that target position
    is physically not available on the aircraft while the other is available,
    redirect the target value to the available position.
    """
    # 1. Determine available physical positions on this aircraft
    available_physical_positions = { (d.get("type") or "").strip() for d in devices }
    
    # Copy positions dict to avoid mutating the original row state directly
    positions = dict(positions)
    
    # 2. Extract targets
    r2_target = positions.get("R2")
    r4_target = positions.get("R4")
    
    r2_given = r2_target is not None and len(str(r2_target).strip()) > 0
    r4_given = r4_target is not None and len(str(r4_target).strip()) > 0
    
    # Only swap if exactly one of them is given
    if r2_given != r4_given:
        r2_phys = "R2" in available_physical_positions
        r4_phys = "R4" in available_physical_positions
        
        # If R2 is given but physically not available, and R4 is physically available:
        if r2_given and not r2_phys and r4_phys:
            positions["R4"] = r2_target
            positions["R2"] = ""  # Clear R2 since it's not available
            logger.info(f"R2 target allocation {r2_target} redirected to R4 because R2 is physically not available on the aircraft.")
            
        # If R4 is given but physically not available, and R2 is physically available:
        elif r4_given and not r4_phys and r2_phys:
            positions["R2"] = r4_target
            positions["R4"] = ""  # Clear R4 since it's not available
            logger.info(f"R4 target allocation {r4_target} redirected to R2 because R4 is physically not available on the aircraft.")

    result = []
    for device in devices:
        pos_type = (device.get("type") or "").strip()
        t_ciid = device.get("t_ciid") or ""
        if not pos_type or not t_ciid:
            continue
        # Check if this position type is in our uploaded data
        if pos_type not in positions:
            continue
        val = positions[pos_type]
        if val is None:
            continue  # UNCLEAR symbol — skip this position entirely
        asset_number = f"RET{val}" if str(val).strip() else ""
        result.append({
            "t_ciid": t_ciid,
            "cart_type": pos_type,
            "asset_number": asset_number
        })
    return result


async def process_bulk_rows(
    rows: List[dict],
    station: str,
    date: str,
    shift_label: Optional[str],
    csv_flights: List[dict],
    dry_run: bool = False
) -> AsyncIterator[str]:
    """
    Async generator yielding SSE event strings.
    Called by the FastAPI streaming endpoint.
    """
    from app.http_client import APIClient
    from app.web_server import parse_cart_allocation_html

    # Stats
    total_processable = sum(1 for r in rows if not r.get("skip_reason"))
    success_count = error_count = retry_cleared = not_found = skipped = 0

    client = None if dry_run else APIClient()

    try:
        processed = 0
        for row in rows:
            sno = row.get("sno")
            flight_no = row.get("flight_no")
            positions: Dict[str, Optional[str]] = row.get("positions", {})
            skip_reason = row.get("skip_reason")

            # --- SKIPPED rows ---
            if skip_reason:
                skipped += 1
                yield _event("flight_skipped", {
                    "flight_no": flight_no, "sno": sno, "reason": skip_reason
                })
                continue

            processed += 1
            yield _event("flight_start", {
                "flight_no": flight_no, "sno": sno,
                "index": processed, "total": total_processable
            })

            # --- Match in CSV ---
            matched = _match_flight(csv_flights, flight_no, station)
            if not matched:
                not_found += 1
                yield _event("flight_not_found", {
                    "flight_no": flight_no, "sno": sno,
                    "reason": f"Flight {flight_no} not found in CSV for station {station}"
                })
                continue

            caterer = matched.get("caterer_code") or matched.get("Caterer_Code") or ""
            aircraft_id = matched.get("aircraft_type_id") or matched.get("AircraftTypeId") or ""

            # --- DRY RUN ---
            if dry_run:
                await asyncio.sleep(0.05)
                success_count += 1
                positions_sent = {k: f"RET{v}" for k, v in positions.items() if v}
                yield _event("flight_success", {
                    "flight_no": flight_no, "sno": sno,
                    "message": "[DRY RUN] Allocation would be submitted.",
                    "positions_sent": positions_sent, "dry_run": True
                })
                continue

            # --- Fetch device positions (t_ciid) from portal ---
            try:
                html = client.get_cart_allocation_html(
                    station=station, date=date,
                    flight_number=str(flight_no),
                    caterer=caterer,
                    aircraft_id=int(aircraft_id) if aircraft_id else None
                )
                parsed = parse_cart_allocation_html(html)
                devices = parsed.get("devices", [])
                yield _event("portal_data", {
                    "flight_no": flight_no,
                    "devices": devices,
                    "carts": parsed.get("carts", []),
                    "flight_meta": {
                        "flight_date": parsed.get("flight_date", ""),
                        "caterer": parsed.get("caterer", ""),
                        "dep": parsed.get("dep", ""),
                        "arr": parsed.get("arr", ""),
                        "std": parsed.get("std", ""),
                        "sta": parsed.get("sta", "")
                    }
                })
            except Exception as e:
                error_count += 1
                yield _event("flight_error", {
                    "flight_no": flight_no, "sno": sno,
                    "message": f"Could not fetch portal data: {e}", "failed_positions": []
                })
                continue

            if not devices:
                skipped += 1
                yield _event("flight_skipped", {
                    "flight_no": flight_no, "sno": sno, "reason": "no_devices_on_portal"
                })
                continue

            # --- Build and submit allocation ---
            allocations = _build_allocations(devices, positions)
            positions_sent = {a["cart_type"]: a["asset_number"] for a in allocations}

            try:
                result = client.update_asset_allocation(
                    station=station,
                    flight_number=str(flight_no),
                    aircraft_type_id=str(aircraft_id),
                    allocations=allocations
                )
            except Exception as e:
                error_count += 1
                yield _event("flight_error", {
                    "flight_no": flight_no, "sno": sno,
                    "message": str(e), "failed_positions": []
                })
                continue

            if result.get("Status") == 1:
                success_count += 1
                yield _event("flight_success", {
                    "flight_no": flight_no, "sno": sno,
                    "message": result.get("message") or "Record(s) Updated Successfully.",
                    "positions_sent": positions_sent,
                    "server_response": result
                })

            else:
                # --- Error: auto-retry by restoring failed positions to original portal values ---
                failed_numbers = _parse_failed_numbers(result)
                failed_positions = [
                    a["cart_type"] for a in allocations
                    if a["asset_number"] in failed_numbers
                ]

                # Build lookup: position type → original portal asset_id (the "Before" value)
                original_portal_values = {}
                for dev in devices:
                    pos_type = (dev.get("type") or "").strip()
                    orig_asset = (dev.get("asset_id") or "").strip()
                    if pos_type:
                        original_portal_values[pos_type] = orig_asset

                yield _event("flight_error", {
                    "flight_no": flight_no, "sno": sno,
                    "message": result.get("message") or "Update failed.",
                    "failed_positions": failed_positions,
                    "server_response": result
                })

                # Restore failed positions to their original portal values (no data loss)
                retry_allocations = []
                restored_positions = {}
                for a in allocations:
                    if a["asset_number"] in failed_numbers:
                        original_val = original_portal_values.get(a["cart_type"], "")
                        retry_allocations.append({**a, "asset_number": original_val})
                        restored_positions[a["cart_type"]] = original_val
                    else:
                        retry_allocations.append(a)

                restored_labels = [
                    f"{pos}→{val or 'empty'}" for pos, val in restored_positions.items()
                ]

                yield _event("flight_retry", {
                    "flight_no": flight_no, "sno": sno,
                    "retry_positions_cleared": list(restored_positions.keys()),
                    "restored_to_original": restored_positions,
                    "message": f"Auto-retrying: restoring [{', '.join(restored_labels)}] to original portal values..."
                })

                try:
                    retry_result = client.update_asset_allocation(
                        station=station,
                        flight_number=str(flight_no),
                        aircraft_type_id=str(aircraft_id),
                        allocations=retry_allocations
                    )
                    if retry_result.get("Status") == 1:
                        retry_cleared += 1
                        retry_positions_sent = {a["cart_type"]: a["asset_number"] for a in retry_allocations}
                        yield _event("flight_retry_success", {
                            "flight_no": flight_no, "sno": sno,
                            "message": f"Retry succeeded. Restored [{', '.join(restored_labels)}] to original portal values.",
                            "positions_sent": retry_positions_sent,
                            "restored_to_original": restored_positions,
                            "server_response": retry_result
                        })
                    else:
                        error_count += 1
                        yield _event("flight_retry_failed", {
                            "flight_no": flight_no, "sno": sno,
                            "message": retry_result.get("message") or "Retry also failed. Manual action required.",
                            "server_response": retry_result
                        })
                except Exception as e:
                    error_count += 1
                    yield _event("flight_retry_failed", {
                        "flight_no": flight_no, "sno": sno,
                        "message": f"Retry failed with exception: {e}"
                    })

            # Sleep to mimic human behavior and avoid anti-bot detection
            if not dry_run and processed < total_processable:
                import random
                sleep_time = random.uniform(1.5, 3.5)
                logger.info(f"Sleeping for {sleep_time:.2f}s to mimic human behavior...")
                yield _event("sleep_start", {
                    "flight_no": flight_no,
                    "duration": round(sleep_time, 1)
                })
                await asyncio.sleep(sleep_time)

        # --- Final summary ---
        yield _event("summary", {
            "total": total_processable,
            "success": success_count,
            "retry_cleared": retry_cleared,
            "skipped": skipped,
            "not_found": not_found,
            "error": error_count,
            "shift_label": shift_label,
            "station": station,
            "date": date,
            "dry_run": dry_run
        })
        yield _event("done", {})

    finally:
        if client:
            client.close()
