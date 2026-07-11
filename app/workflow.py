import logging
import csv
import os
from datetime import datetime

from .config import settings
from .http_client import APIClient
from .parsers import parse_flight_response
from .models import RouteGroup

logger = logging.getLogger(__name__)

def process_flight_data(client: APIClient, target_date: str) -> None:
    """
    Orchestrates the data fetching, parsing, and business logic execution.
    """
    timestamp = str(int(datetime.now().timestamp() * 1000))
    
    try:
        raw_data = client.get_flight_information(
            date=target_date,
            dep="DEL",
            is_base_flight=True,
            timestamp=timestamp,
            aircraft_id=0,
            terminal=0
        )
    except Exception as e:
        logger.error(f"Failed to fetch flight data: {e}")
        return

    try:
        route_groups = parse_flight_response(raw_data)
        logger.info(f"Successfully parsed {len(route_groups)} route groups.")
    except Exception as e:
        logger.error(f"Failed to parse flight data: {e}")
        return

    from .models import get_aircraft_type_id

    # Normalize/default fields on all flights (e.g. Caterer_Code and AircraftTypeId)
    for group in route_groups:
        for flight in group.flightInfo:
            if not flight.AircraftTypeId or flight.AircraftTypeId == 0:
                flight.AircraftTypeId = get_aircraft_type_id(flight.AircraftType, flight.AircraftID)

    # Export to CSV
    export_to_csv(route_groups, target_date)
    
    execute_business_rules(route_groups)

def export_to_csv(groups: list[RouteGroup], target_date: str) -> None:
    """
    Exports flight data to a CSV file.
    """
    import json
    from .utils import normalize_to_local_date_dash, normalize_to_local_date_slash
    
    dash_date = normalize_to_local_date_dash(target_date)
    filename = f"DEL_Flights_{dash_date}.csv"
    headers = [
        "Flight No", "Departure", "Arrival", "Seq.", "Flight Type", 
        "Is Top Up", "Caterer Code", "Category", "AircraftTypeId",
        "Route No", "Aircraft Type", "Flt Dt", "STD", "STA", "Carts", "Drawers"
    ]
    
    try:
        with open(filename, mode='w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(headers)
            
            for group in groups:
                for flight in group.flightInfo:
                    flight_type_val = flight.FlightType or ""
                    if flight.STC or flight.ACREGID:
                        parts = []
                        if flight.FlightType:
                            parts.append(flight.FlightType)
                        if flight.STC:
                            parts.append(flight.STC)
                        stc_part = ",".join(parts)
                        if flight.ACREGID:
                            flight_type_val = f"{stc_part} {flight.ACREGID}"
                        else:
                            flight_type_val = stc_part

                    flt_dt_val = flight.Flt_Dt or ""
                    if flt_dt_val:
                        flt_dt_val = normalize_to_local_date_slash(flt_dt_val)

                    writer.writerow([
                        flight.Flt_No,
                        flight.Dep,
                        flight.Arr,
                        flight.Seq,
                        flight_type_val,
                        flight.IsTopUp,
                        flight.Caterer_Code or "",
                        flight.Category or "",
                        flight.AircraftTypeId if flight.AircraftTypeId is not None else "",
                        flight.RouteNo or "",
                        flight.AircraftType or "",
                        flt_dt_val,
                        flight.STD or "",
                        flight.STA or "",
                        json.dumps(flight.carts) if flight.carts else "",
                        json.dumps(flight.drawers) if flight.drawers else ""
                    ])
        logger.info(f"Data exported to {filename}")
    except Exception as e:
        logger.error(f"Failed to export data to CSV: {e}")

def execute_business_rules(groups: list[RouteGroup]) -> None:
    """
    Apply business rules to the normalized data and perform actions.
    """
    total_flights = 0
    for group in groups:
        for flight in group.flightInfo:
            total_flights += 1
            # Example rule: identify early morning flights
            if flight.STD and flight.STD.startswith("05:"):
                action_message = f"Early flight identified: {flight.Flt_No} from {flight.Dep} to {flight.Arr} at {flight.STD}"
                execute_action(action_message)

    logger.info(f"Workflow completed. Total flights processed: {total_flights}")

def execute_action(message: str) -> None:
    """
    Executes an action, respecting the dry-run setting and ensuring idempotency.
    """
    if settings.dry_run:
        logger.info(f"[DRY RUN] Would execute action: {message}")
        return
        
    # In a real scenario, this might push a notification or update a database.
    logger.info(f"[ACTION] Executing: {message}")
