# GoIndigo Flight Automation & Bulk MPOS Allocation System

A professional, production-grade automation system and web-based dashboard for managing flight allocations, bulk uploading mobile Point-of-Sale (MPOS) device configurations, and synchronizing with the Indigo Flight Portal.

---

## 🌟 Key Features

1. **Flight Data Synchronization**: Automatically downloads flight details from the official portal (`cops.goindigo.in`) using a robust HTTP client with built-in retry mechanisms and backoff support.
2. **Universal Bulk MPOS Table Parser**:
   - Parses multiple formats: **Images (PNG, JPG, WebP)**, **PDFs**, **Excel Spreadsheets (`.xlsx`, `.xls`)**, **CSV files**, and **plain text / markdown pastes**.
   - Integrates **PaddleOCR / PaddlePaddle** and **img2table** for advanced OCR table structure extraction.
3. **Advanced Business Logic & Allocation Routing**:
   - Matches scanned flight data against cached schedules with fuzzy matching logic.
   - **R2 / R4 Swap Resolution**: Automatically resolves equipment constraints where target positions (e.g., `R2`) are not physically available on the aircraft, routing allocations to alternative positions (e.g., `R4`) transparently.
4. **Interactive Glassmorphic Web Dashboard**:
   - Real-time event streaming via **Server-Sent Events (SSE)**.
   - Interactive configuration, manual flight triggering, log viewing, and bulk spreadsheet upload.
5. **CLI Scheduler**: Allows daemonized background polling of schedules when running headlessly.
6. **Robust Testing Suite**: Contains comprehensive unit and integration tests using `pytest` to verify parsers and hardening of authorization tokens.

---

## 📁 Repository Directory Structure

```text
GoIndigoAI/
├── app/
│   ├── __init__.py
│   ├── auth.py              # Cookie injection and auth handling
│   ├── auth_automation.py   # Playwright-driven login automation
│   ├── bulk_parser.py       # Multi-format parser (Excel, CSV, PDF, OCR for images)
│   ├── bulk_processor.py    # SSE stream processor and allocation business rules
│   ├── config.py            # Pydantic-based settings manager (.env loader)
│   ├── exceptions.py        # Centralized exceptions
│   ├── http_client.py       # HTTP client with exponential backoff retries
│   ├── logging_setup.py     # Log routing and format configuration
│   ├── models.py            # Pydantic models for data validation and normalization
│   ├── parsers.py           # Core flight parser routines
│   ├── scheduler.py         # Background CLI scheduling loop
│   ├── utils.py             # Date and string normalization helper utilities
│   ├── web_server.py        # FastAPI server running the web dashboard & API endpoints
│   └── workflow.py          # Central business rules and flight data export workflow
├── static/                  # Web Dashboard frontend assets
│   ├── app.js               # Frontend dashboard state and SSE log viewer
│   ├── bulk_upload.js       # Table parser, Excel preview, and SSE stream renderer
│   ├── bulk_upload.css      # Modern Glassmorphic CSS style definitions
│   ├── style.css            # Global CSS styling
│   └── index.html           # Main dashboard web app template
├── tests/                   # Pytest automation test suites
│   ├── test_auth_harden.py  # Hardening validations for authentication logic
│   ├── test_parsers.py      # Test parser variants for CSV, Excel, PDF, and OCR
│   └── test_workflow.py     # End-to-end workflow verification
├── main.py                  # CLI entry point to start the app, scheduler, or web server
├── requirements.txt         # Project package dependencies
├── .env.example             # Template for configuring secrets and API base URLs
└── .gitignore               # Configures what files to ignore from Git version control
```

---

## ⚙️ Setup and Installation

### 1. Prerequisites
- **Python 3.11+** installed on your system.
- **Git** configured.

### 2. Create Virtual Environment & Install Dependencies
Clone the repository, set up a virtual environment, and install dependencies:
```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Linux/macOS:
source venv/bin/activate
# On Windows (Command Prompt):
venv\Scripts\activate
# On Windows (PowerShell):
.\venv\Scripts\activate

# Upgrade pip and install requirements
pip install --upgrade pip
pip install -r requirements.txt
```

### 3. Setup Playwright Browsers
Since the application uses Playwright for login automation, install the required browser binaries:
```bash
playwright install chromium
```

### 4. Configure Environment Variables
Copy `.env.example` to a new file named `.env` and fill in the required configurations:
```bash
cp .env.example .env
```
Ensure you fill in valid authentication cookies or credentials if running in production mode.

---

## 🚀 Running the Application

### 1. Web Dashboard (Default / Recommended)
Start the FastAPI server with live dashboard reload disabled:
```bash
python main.py
```
By default, the server will bind to `http://127.0.0.1:8000`. Navigate to this address in your browser to access the dashboard.

To start with custom bindings or SSL certificates (HTTPS):
```bash
python main.py --host 0.0.0.0 --port 8443 --ssl-certfile cert.pem --ssl-keyfile key.pem
```

### 2. Run Workflow Once (CLI Mode)
To pull flight schedules for a specific date and export to CSV immediately:
```bash
python main.py --once --date "07/11/2026"
```

### 3. Background CLI Scheduler
Run the application continuously as a background scheduler using the CLI parser instead of starting the web dashboard:
```bash
python main.py --cli
```

---

## 🧪 Running Tests

A comprehensive suite of unit tests is included. Run them using:
```bash
pytest tests/
```
To run tests with stdout output printed:
```bash
pytest -s tests/
```

---

## 🔒 Security Best Practices

- **Never Commit `.env` File**: The `.env` file contains sensitive authentication cookies and endpoint domains. Ensure `.gitignore` is active and successfully ignoring `.env`.
- **Session Lifespans**: Cookies harvested from the portal expire regularly. Use the automated Playwright flow (`app/auth_automation.py`) or update cookies via the Web UI Settings panel to keep the session alive.
