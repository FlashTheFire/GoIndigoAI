import re
import pytest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException
from fastapi.testclient import TestClient
import httpx

from app.web_server import app, validate_cookie_format
from app.config import settings
from app.http_client import APIClient
from app.exceptions import APIError

client = TestClient(app)


def test_validate_cookie_format_success():
    # Valid session ID (24 characters alphanumeric)
    validate_cookie_format("ASP.NET_SessionId", "abcdefghijklmnopqrstuvwx")
    # Valid session ID with dashes
    validate_cookie_format("ASP.NET_SessionId", "session-id-12345-abcde")
    
    # Valid COPS token (long string, alphanumeric + base64 chars)
    validate_cookie_format("COPSWeb02", "A" * 100)
    validate_cookie_format("COPSWeb021", "B" * 500 + "==")


def test_validate_cookie_format_invalid_session():
    # Too short
    with pytest.raises(HTTPException) as exc:
        validate_cookie_format("ASP.NET_SessionId", "abc")
    assert exc.value.status_code == 400

    # Too long
    with pytest.raises(HTTPException) as exc:
        validate_cookie_format("ASP.NET_SessionId", "a" * 50)
    assert exc.value.status_code == 400

    # Invalid characters (e.g. angle brackets, quotes)
    with pytest.raises(HTTPException) as exc:
        validate_cookie_format("ASP.NET_SessionId", "abcde<script>fgh")
    assert exc.value.status_code == 400


def test_validate_cookie_format_invalid_cops():
    # Too short
    with pytest.raises(HTTPException) as exc:
        validate_cookie_format("COPSWeb02", "short")
    assert exc.value.status_code == 400

    # Too long
    with pytest.raises(HTTPException) as exc:
        validate_cookie_format("COPSWeb02", "a" * 10001)
    assert exc.value.status_code == 400

    # Invalid character (e.g. HTML / script tag injection)
    with pytest.raises(HTTPException) as exc:
        validate_cookie_format("COPSWeb02", "A" * 50 + "<script>")
    assert exc.value.status_code == 400


def test_cors_middleware_allowed_origins():
    # Localhost origin should match
    headers = {"Origin": "http://localhost:8888"}
    response = client.options("/api/status", headers=headers)
    assert response.headers.get("access-control-allow-origin") == "http://localhost:8888"

    # 127.0.0.1 origin should match
    headers = {"Origin": "http://127.0.0.1"}
    response = client.options("/api/status", headers=headers)
    assert response.headers.get("access-control-allow-origin") == "http://127.0.0.1"


def test_cors_middleware_disallowed_origin():
    # Untrusted domain origin should NOT match
    headers = {"Origin": "https://evil.com"}
    response = client.options("/api/status", headers=headers)
    assert response.headers.get("access-control-allow-origin") is None


def test_pna_header_injection():
    # Preflight options request requesting PNA should receive Access-Control-Allow-Private-Network: true
    headers = {
        "Origin": "http://localhost:8888",
        "Access-Control-Request-Private-Network": "true"
    }
    response = client.options("/api/status", headers=headers)
    assert response.headers.get("access-control-allow-private-network") == "true"


def test_api_client_request_redirect_handling():
    # Mock httpx.Client request to return a 302 redirect response
    mock_response = MagicMock(spec=httpx.Response)
    mock_response.status_code = 302
    mock_response.headers = {"Location": "https://login.microsoftonline.com/auth"}
    
    with patch("httpx.Client.request", return_value=mock_response):
        api_client = APIClient()
        with pytest.raises(APIError) as exc_info:
            api_client._request("GET", "/test-endpoint")
        assert "Authentication required (302 Redirect)" in str(exc_info.value)


def test_date_normalization_helpers():
    from app.utils import (
        normalize_to_portal_date,
        normalize_to_local_date_slash,
        normalize_to_local_date_dash
    )
    
    # 1. normalize_to_portal_date (target: MM/DD/YYYY)
    assert normalize_to_portal_date("05/06/2026") == "06/05/2026"
    assert normalize_to_portal_date("05-06-2026") == "06/05/2026"
    assert normalize_to_portal_date("2026-06-05T00:00:00") == "06/05/2026"
    assert normalize_to_portal_date("2026-06-05") == "06/05/2026"
    
    # 2. normalize_to_local_date_slash (target: DD/MM/YYYY)
    assert normalize_to_local_date_slash("05/06/2026") == "05/06/2026"
    assert normalize_to_local_date_slash("05-06-2026") == "05/06/2026"
    assert normalize_to_local_date_slash("2026-06-05T00:00:00") == "05/06/2026"
    
    # 3. normalize_to_local_date_dash (target: DD-MM-YYYY)
    assert normalize_to_local_date_dash("05/06/2026") == "05-06-2026"
    assert normalize_to_local_date_dash("05-06-2026") == "05-06-2026"
    assert normalize_to_local_date_dash("2026-06-05T00:00:00") == "05-06-2026"




