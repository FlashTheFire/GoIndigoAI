import time
import logging
from typing import Dict, Any, Optional
from playwright.sync_api import sync_playwright

from .config import settings

logger = logging.getLogger(__name__)

def automate_authentication(headless: bool = False) -> Dict[str, Any]:
    """
    Launches a browser (using system Edge or Chrome with persistent profile) to automate authentication.
    Monitors cookies and extracts COPSWeb02, COPSWeb021, and ASP.NET_SessionId.
    """
    logger.info(f"Starting automated authentication process via browser (headless={headless})...")
    import os
    profile_dir = os.path.join(os.getcwd(), ".cops_browser_profile")
    
    with sync_playwright() as p:
        context = None
        # Try MS Edge first (default on Windows), then Chrome, then default Chromium channel
        for channel in ["msedge", "chrome", None]:
            try:
                launch_args = {
                    "headless": headless,
                    "user_data_dir": profile_dir,
                }
                if channel:
                    launch_args["channel"] = channel
                
                logger.info(f"Attempting to launch persistent browser with channel={channel}...")
                context = p.chromium.launch_persistent_context(**launch_args)
                break
            except Exception as e:
                logger.warning(f"Failed to launch with channel {channel}: {e}")
                
        if not context:
            logger.error("Could not launch any browser. Please install Microsoft Edge or Google Chrome.")
            return {
                "status": "error",
                "message": "Could not launch Edge or Chrome browser. Please ensure Edge or Chrome is installed."
            }
            
        page = context.pages[0] if context.pages else context.new_page()
        
        # Navigate to target page
        target_url = "https://cops.goindigo.in/"
        logger.info(f"Navigating browser to {target_url}")
        
        try:
            page.goto(target_url)
            
            # Poll for cookies
            timeout_seconds = 180  # 3 minutes maximum timeout
            poll_interval = 1
            found_cops02 = None
            found_cops021 = None
            found_session = None
            
            logger.info("Waiting for user to log in and cookies to be set...")
            
            for elapsed in range(0, timeout_seconds, poll_interval):
                if page.is_closed():
                    logger.warning("Browser window was closed by the user.")
                    return {
                        "status": "error",
                        "message": "Browser window was closed before login was completed."
                    }
                    
                # Inspect cookies
                cookies = context.cookies()
                for cookie in cookies:
                    if cookie["name"] == "COPSWeb02":
                        found_cops02 = cookie["value"]
                    elif cookie["name"] == "COPSWeb021":
                        found_cops021 = cookie["value"]
                    elif cookie["name"] == "ASP.NET_SessionId":
                        found_session = cookie["value"]
                
                if found_cops02 and found_cops021 and found_session:
                    logger.info("Successfully intercepted all authentication cookies!")
                    break
                    
                time.sleep(poll_interval)
                
            if not (found_cops02 and found_cops021 and found_session):
                logger.error("Authentication timed out waiting for cookies.")
                return {
                    "status": "error",
                    "message": "Authentication timed out. Cookies were not set."
                }
                
            # Update settings in memory
            settings.auth_cookie_copsweb02 = found_cops02
            settings.auth_cookie_copsweb021 = found_cops021
            settings.auth_cookie_session = found_session
            
            # Save settings to .env
            settings.save_to_env()
            logger.info("Authentication cookies updated in settings and saved to .env file.")
            
            return {
                "status": "success",
                "message": "Authentication cookies successfully extracted and updated.",
                "cookies": {
                    "COPSWeb02_length": len(found_cops02),
                    "COPSWeb021_length": len(found_cops021),
                    "ASP.NET_SessionId": found_session
                }
            }
            
        except Exception as e:
            logger.error(f"Error during authentication capture: {e}")
            return {
                "status": "error",
                "message": f"An error occurred during authentication: {str(e)}"
              }
        finally:
            context.close()
