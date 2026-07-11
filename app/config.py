import os
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    api_base_url: str = "https://cops.goindigo.in"
    api_endpoint: str = "/FlightInfoWeb/LoadFlightInformation"
    poll_interval_seconds: int = 300
    keep_alive_interval_seconds: int = 180
    log_level: str = "INFO"
    timeout_seconds: int = 30
    max_retries: int = 3
    dry_run: bool = False
    
    # Auth configuration
    auth_cookie_copsweb02: str = ""
    auth_cookie_copsweb021: str = ""
    auth_cookie_session: str = ""
    
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    def save_to_env(self) -> None:
        """Saves current settings back to the .env file atomically."""
        content = f'''# API Config
API_BASE_URL="{self.api_base_url}"
API_ENDPOINT="{self.api_endpoint}"
POLL_INTERVAL_SECONDS={self.poll_interval_seconds}
KEEP_ALIVE_INTERVAL_SECONDS={self.keep_alive_interval_seconds}
LOG_LEVEL="{self.log_level}"
TIMEOUT_SECONDS={self.timeout_seconds}
MAX_RETRIES={self.max_retries}
DRY_RUN={str(self.dry_run)}

# Authentication Cookies
AUTH_COOKIE_COPSWEB02="{self.auth_cookie_copsweb02}"
AUTH_COOKIE_COPSWEB021="{self.auth_cookie_copsweb021}"
AUTH_COOKIE_SESSION="{self.auth_cookie_session}"
'''
        import tempfile
        # Write to a temporary file in the same directory, then rename it atomically
        dir_name = os.path.dirname(os.path.abspath(".env"))
        with tempfile.NamedTemporaryFile("w", dir=dir_name, delete=False, encoding="utf-8", suffix=".tmp") as temp_file:
            temp_file.write(content)
            temp_path = temp_file.name
        try:
            os.replace(temp_path, ".env")
        except Exception as e:
            # Fallback cleanup if rename fails
            if os.path.exists(temp_path):
                os.remove(temp_path)
            raise e

settings = Settings()

