import time
import logging
# pyrefly: ignore [missing-import]
import schedule

from .config import settings
from .http_client import APIClient
from .workflow import process_flight_data

logger = logging.getLogger(__name__)

def job() -> None:
    logger.info("Starting scheduled job...")
    client = APIClient()
    try:
        # Use current date dynamically
        from datetime import datetime
        target_date = datetime.now().strftime("%d/%m/%Y")
        process_flight_data(client, target_date)
    finally:
        client.close()

def run_scheduler() -> None:
    logger.info(f"Starting scheduler. Polling interval: {settings.poll_interval_seconds} seconds.")
    
    # Run immediately on startup
    job()
    
    # Schedule future runs
    schedule.every(settings.poll_interval_seconds).seconds.do(job)
    
    while True:
        try:
            schedule.run_pending()
            time.sleep(1)
        except KeyboardInterrupt:
            logger.info("Scheduler stopped by user.")
            break
        except Exception as e:
            logger.error(f"Unexpected error in scheduler: {e}")
            time.sleep(10)
