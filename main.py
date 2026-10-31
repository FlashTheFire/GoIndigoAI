import sys
import logging
import argparse

from app.config import settings
from app.logging_setup import setup_logging
from app.scheduler import run_scheduler
from app.workflow import process_flight_data
from app.http_client import APIClient

logger = logging.getLogger(__name__)

def main() -> None:
    parser = argparse.ArgumentParser(description="GoIndigo Flight Automation Workflow")
    from datetime import datetime
    default_date = datetime.now().strftime("%m/%d/%Y")
    parser.add_argument("--once", action="store_true", help="Run the workflow once instead of scheduling")
    parser.add_argument("--cli", action="store_true", help="Run the CLI scheduler instead of the web dashboard")
    parser.add_argument("--date", type=str, default=default_date, help="Target date for the API request (MM/DD/YYYY)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host address to bind the web server")
    parser.add_argument("--port", type=int, default=8888, help="Port to bind the web server")
    parser.add_argument("--ssl-keyfile", type=str, default=None, help="SSL key file path for HTTPS")
    parser.add_argument("--ssl-certfile", type=str, default=None, help="SSL certificate file path for HTTPS")
    args = parser.parse_args()

    setup_logging(settings.log_level)
    logger.info("Initializing Automation Project")
    
    if args.once:
        logger.info("Running workflow once...")
        client = APIClient()
        try:
            process_flight_data(client, args.date)
        finally:
            client.close()
    elif args.cli:
        run_scheduler()
    else:
        import uvicorn
        logger.info(f"Starting Web Dashboard on {'https' if args.ssl_certfile else 'http'}://{args.host}:{args.port}")
        uvicorn.run(
            "app.web_server:app",
            host=args.host,
            port=args.port,
            reload=False,
            ssl_keyfile=args.ssl_keyfile,
            ssl_certfile=args.ssl_certfile
        )

if __name__ == "__main__":
    sys.exit(main())

