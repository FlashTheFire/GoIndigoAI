import json
import logging
from typing import List, Any
from pydantic import ValidationError

from .models import RouteGroup
from .exceptions import ValidationError as AppValidationError

logger = logging.getLogger(__name__)

def parse_flight_response(raw_text: str) -> List[RouteGroup]:
    """
    Parses the raw JSON response into Pydantic models.
    """
    try:
        data = json.loads(raw_text)
        
        # Sometimes the API might double-encode the JSON as a string
        if isinstance(data, str):
            data = json.loads(data)
            
        if not isinstance(data, list):
            logger.error("Expected response to be a list of route groups.")
            return []
            
        if data and 'flightInfo' in data[0] and data[0]['flightInfo']:
            # Inspect first flight raw data to see if AircraftTypeId exists
            logger.debug(f"DEBUG: First flight raw data: {json.dumps(data[0]['flightInfo'][0])}")

        groups = []
        for item in data:
            try:
                group = RouteGroup(**item)
                groups.append(group)
            except ValidationError as e:
                logger.warning(f"Failed to parse group item safely. Skipping. Error: {e}")
                
        return groups
    except json.JSONDecodeError as e:
        logger.error(f"Failed to decode JSON response: {e}")
        raise AppValidationError(f"Invalid JSON: {e}")
