import httpx
import logging
import tenacity
from typing import Any, Dict, Optional

from .config import settings
from .auth import get_auth_cookies, get_auth_headers
from .exceptions import APIError

logger = logging.getLogger(__name__)

class APIClient:
    def __init__(self):
        self.base_url = settings.api_base_url
        self.client = httpx.Client(
            base_url=self.base_url,
            timeout=settings.timeout_seconds,
            headers=get_auth_headers(),
            cookies=get_auth_cookies()
        )

    def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        """
        Helper method to send requests. Updates cookies dynamically from settings 
        and raises an APIError if a 302 redirect (authentication challenge) is received.
        """
        # Dynamically load the latest cookies from settings before each request
        self.client.cookies.update(get_auth_cookies())
        
        response = self.client.request(method, url, **kwargs)
        
        # Check for 302 redirect which indicates authentication is expired/required
        if response.status_code == 302:
            location = response.headers.get("Location", "")
            logger.error(f"Authentication failed: Received a 302 redirect to {location}")
            raise APIError("Authentication required (302 Redirect)")
            
        return response

    @tenacity.retry(
        wait=tenacity.wait_exponential(multiplier=1, min=2, max=10),
        stop=tenacity.stop_after_attempt(settings.max_retries),
        retry=tenacity.retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError, APIError)),
        before_sleep=lambda retry_state: logger.warning(f"Retrying request after error: {retry_state.outcome.exception()}")
    )
    def get_flight_information(self, date: str, dep: str, is_base_flight: bool, timestamp: str, aircraft_id: int, terminal: int) -> str:
        """
        Fetches flight information from the API.
        """
        from .utils import normalize_to_portal_date
        params = {
            "FlightDate": normalize_to_portal_date(date),
            "DEP": dep,
            "IsBaseFlight": str(is_base_flight).lower(),
            "Timestamp": timestamp,
            "AircraftID": aircraft_id,
            "Terminal": terminal
        }
        
        url = settings.api_endpoint
        logger.info(f"Fetching data from {url} with params {params}")
        
        response = self._request("GET", url, params=params)
        response.raise_for_status()
        return response.text

    def get_cart_allocations(self, station: str, date: str, flight_number: str, caterer: str, aircraft_id: int) -> tuple[dict, dict]:
        """
        Fetches and parses cart and drawer allocations for a specific flight.
        Returns a tuple of (carts_dict, drawers_dict).
        """
        import re
        
        try:
            html = self.get_cart_allocation_html(station, date, flight_number, caterer, aircraft_id)
        except Exception as e:
            logger.error(f"Error fetching cart allocations for flight {flight_number}: {e}")
            return {}, {}

        # Parse CartTypeModelList (Carts)
        cart_types = {}
        for m in re.finditer(r'name="\[\d+\]\.CartTypeModelList\[(\d+)\]\.CartType"[^>]*value="([^"]*)"', html):
            cart_types[int(m.group(1))] = m.group(2)
        for m in re.finditer(r'value="([^"]*)"[^>]*name="\[\d+\]\.CartTypeModelList\[(\d+)\]\.CartType"', html):
            cart_types[int(m.group(2))] = m.group(1)
            
        cart_numbers = {}
        for m in re.finditer(r'name="\[\d+\]\.CartTypeModelList\[(\d+)\]\.M_CartId"[^>]*value="([^"]*)"', html):
            cart_numbers[int(m.group(1))] = m.group(2)
        for m in re.finditer(r'value="([^"]*)"[^>]*name="\[\d+\]\.CartTypeModelList\[(\d+)\]\.M_CartId"', html):
            cart_numbers[int(m.group(2))] = m.group(1)
            
        carts = {cart_types[idx]: cart_numbers.get(idx, "") for idx in cart_types if cart_types[idx]}

        # Parse AssetTypeModelList (Drawers)
        asset_cart_types = {}
        for m in re.finditer(r'name="\[\d+\]\.AssetTypeModelList\[(\d+)\]\.CartType"[^>]*value="([^"]*)"', html):
            asset_cart_types[int(m.group(1))] = m.group(2)
        for m in re.finditer(r'value="([^"]*)"[^>]*name="\[\d+\]\.AssetTypeModelList\[(\d+)\]\.CartType"', html):
            asset_cart_types[int(m.group(2))] = m.group(1)
            
        asset_ids = {}
        for m in re.finditer(r'name="\[\d+\]\.AssetTypeModelList\[(\d+)\]\.AssetId"[^>]*value="([^"]*)"', html):
            asset_ids[int(m.group(1))] = m.group(2)
        for m in re.finditer(r'value="([^"]*)"[^>]*name="\[\d+\]\.AssetTypeModelList\[(\d+)\]\.AssetId"', html):
            asset_ids[int(m.group(2))] = m.group(1)
            
        drawers = {}
        for idx, cart_type in asset_cart_types.items():
            if not cart_type:
                continue
            asset_val = asset_ids.get(idx, "")
            drawers[cart_type] = "RET" + asset_val if asset_val else ""

        return carts, drawers

    def get_cart_allocation_html(self, station: str, date: str, flight_number: str, caterer: str, aircraft_id: Optional[int]) -> str:
        """
        Fetches the raw cart allocation HTML partial from /CartAllocation/FetchTableData.
        """
        from datetime import datetime
        from .utils import normalize_to_portal_date
        
        formatted_date = normalize_to_portal_date(date)

        params = {
            "Station": station,
            "FlightDate": formatted_date,
            "FlightNumber": str(flight_number),
            "Caterer": caterer,
            "AircraftID": str(aircraft_id) if aircraft_id is not None else "",
            "Timestamp": str(int(datetime.now().timestamp() * 1000))
        }
        
        url = "/CartAllocation/FetchTableData"
        logger.info(f"Fetching raw cart HTML from {url} with params {params}")
        
        response = self._request("GET", url, params=params)
        response.raise_for_status()
        return response.text

    def update_asset_allocation(self, station: str, flight_number: str, aircraft_type_id: str, allocations: list) -> dict:
        """
        Sends asset allocations update request to Indigo portal.
        """
        payload = {
            "AssetAllocation": [
                {
                    "T_CIId": str(item["t_ciid"]),
                    "CartType": item["cart_type"],
                    "AssetNumber": item["asset_number"],
                    "Station": station,
                    "AircraftType": str(aircraft_type_id)
                }
                for item in allocations
            ],
            "FlightNumber": str(flight_number)
        }
        
        url = "/CartAllocation/UpdateAssetType"
        logger.info(f"Posting asset update to {url}: {payload}")
        
        response = self._request("POST", url, json=payload)
        response.raise_for_status()
        return response.json()

    def close(self):
        self.client.close()
