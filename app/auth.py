import logging
from typing import Dict
from .config import settings

logger = logging.getLogger(__name__)

def get_auth_cookies() -> Dict[str, str]:
    """
    Returns the required cookies for authenticating with the API.
    """
    cookies = {}
    if settings.auth_cookie_copsweb02:
        cookies["COPSWeb02"] = settings.auth_cookie_copsweb02
    if settings.auth_cookie_copsweb021:
        cookies["COPSWeb021"] = settings.auth_cookie_copsweb021
    if settings.auth_cookie_session:
        cookies["ASP.NET_SessionId"] = settings.auth_cookie_session
    
    if not cookies:
        logger.warning("No authentication cookies provided in environment.")
        
    return cookies

def get_auth_headers() -> Dict[str, str]:
    """
    Returns default headers required by the API.
    """
    return {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": f"{settings.api_base_url}/FlightInfoWeb/FlightInformation?DEP=DEL&IsBaseFlight=true",
        "Sec-CH-UA": '"Not-A.Brand";v="24", "Chromium";v="146"',
        "Sec-CH-UA-Mobile": "?0",
        "Sec-CH-UA-Platform": '"Windows"',
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "X-Requested-With": "XMLHttpRequest",
    }
