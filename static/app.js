// Global State
let flightsList = [];
window.flightsList = flightsList;
let activeFile = "";
let isSettingsLoaded = false;
let lastLogCount = 0;
let popupTimeoutId = null;

// On Page Load
document.addEventListener("DOMContentLoaded", () => {
    // Set default date in picker to today in DD/MM/YYYY format
    const dateInput = document.getElementById("input-sync-date");
    const hiddenPicker = document.getElementById("hidden-date-picker");
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    
    if (dateInput) {
        dateInput.value = `${dd}/${mm}/${yyyy}`;
        
        // Keystroke formatter for DD/MM/YYYY
        dateInput.addEventListener("input", function(e) {
            let val = e.target.value;
            let clean = val.replace(/\D/g, "");
            if (clean.length > 8) {
                clean = clean.substring(0, 8);
            }
            let formatted = "";
            if (clean.length > 0) {
                formatted = clean.substring(0, 2);
                if (clean.length > 2) {
                    formatted += "/" + clean.substring(2, 4);
                    if (clean.length > 4) {
                        formatted += "/" + clean.substring(4, 8);
                    }
                }
            }
            e.target.value = formatted;
            validateDateInput(e.target);
        });

        // Blur validation
        dateInput.addEventListener("blur", function(e) {
            validateDateInput(e.target, true);
        });
    }
    
    if (hiddenPicker) {
        hiddenPicker.value = `${yyyy}-${mm}-${dd}`;
        hiddenPicker.addEventListener("change", function(e) {
            const val = e.target.value; // YYYY-MM-DD
            if (val) {
                const parts = val.split("-");
                if (parts.length === 3 && dateInput) {
                    dateInput.value = `${parts[2]}/${parts[1]}/${parts[0]}`; // DD/MM/YYYY
                    validateDateInput(dateInput);
                }
            }
        });
    }

    // Load initial settings and data
    loadRawSettings();
    pollStatus();
    loadCSVFiles();
    loadFlights();
    pollLogs();

    // Start periodic polling
    setInterval(pollStatus, 3000);
    setInterval(pollLogs, 2000);
});

// Toast notification helper
function showToast(message, isError = false) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = `toast ${isError ? 'error' : ''}`;
    toast.classList.remove("hidden");
    setTimeout(() => {
        toast.classList.add("hidden");
    }, 4000);
}

// Custom Modal Popup Helper
function showPopup(title, message, isError = false) {
    const popup = document.getElementById("custom-popup");
    const iconContainer = document.getElementById("popup-icon");
    const titleEl = document.getElementById("popup-title");
    const msgEl = document.getElementById("popup-message");
    const btn = document.getElementById("btn-close-popup-cross");

    titleEl.textContent = title;
    msgEl.innerHTML = message;

    if (isError) {
        iconContainer.style.background = "rgba(255, 82, 82, 0.15)";
        iconContainer.style.color = "var(--danger)";
        iconContainer.innerHTML = `
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
        `;
    } else {
        iconContainer.style.background = "rgba(46, 204, 113, 0.15)";
        iconContainer.style.color = "var(--success)";
        iconContainer.innerHTML = `
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
        `;
    }

    if (popupTimeoutId) {
        clearTimeout(popupTimeoutId);
        popupTimeoutId = null;
    }

    popup.classList.remove("hidden");

    const closeHandler = () => {
        popup.classList.add("hidden");
        if (popupTimeoutId) {
            clearTimeout(popupTimeoutId);
            popupTimeoutId = null;
        }
    };
    
    btn.onclick = closeHandler;
    popup.onclick = (e) => {
        if (e.target === popup) {
            closeHandler();
        }
    };

    // Auto hide after 4 seconds only if not an error message
    if (!isError) {
        popupTimeoutId = setTimeout(closeHandler, 4000);
    }
}


// Format date helper (keeps DD/MM/YYYY)
function formatDateToAPI(dateStr) {
    if (!dateStr) return "";
    if (dateStr.includes("/")) {
        const parts = dateStr.split("/");
        if (parts.length === 3) {
            return `${parts[0]}/${parts[1]}/${parts[2]}`; // DD/MM/YYYY
        }
    } else if (dateStr.includes("-")) {
        const parts = dateStr.split("-");
        if (parts.length === 3) {
            if (parts[0].length === 4) {
                return `${parts[2]}/${parts[1]}/${parts[0]}`; // YYYY-MM-DD to DD/MM/YYYY
            }
            return `${parts[0]}/${parts[1]}/${parts[2]}`; // DD-MM-YYYY to DD/MM/YYYY
        }
    }
    return dateStr;
}

// Validate DD/MM/YYYY format and calendar correctness
function validateDateInput(input, showAlert = false) {
    const val = input.value;
    if (!val) {
        input.classList.remove("invalid", "valid");
        return false;
    }
    
    const regex = /^\d{2}\/\d{2}\/\d{4}$/;
    if (!regex.test(val)) {
        input.classList.add("invalid");
        input.classList.remove("valid");
        if (showAlert && val.length > 0) {
            showToast("Invalid date format. Please use DD/MM/YYYY.", true);
        }
        return false;
    }
    
    const parts = val.split("/");
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    
    const d = new Date(year, month, day);
    if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) {
        input.classList.remove("invalid");
        input.classList.add("valid");
        
        // Sync with hidden picker
        const hiddenPicker = document.getElementById("hidden-date-picker");
        if (hiddenPicker) {
            const yyyy = year;
            const mm = String(month + 1).padStart(2, '0');
            const dd = String(day).padStart(2, '0');
            hiddenPicker.value = `${yyyy}-${mm}-${dd}`;
        }
        return true;
    } else {
        input.classList.add("invalid");
        input.classList.remove("valid");
        if (showAlert) {
            showToast("Invalid calendar date.", true);
        }
        return false;
    }
}

// Open native calendar date picker on icon click
function openNativeDatePicker() {
    const hiddenPicker = document.getElementById("hidden-date-picker");
    if (hiddenPicker) {
        try {
            hiddenPicker.showPicker();
        } catch (e) {
            hiddenPicker.click();
        }
    }
}

// Toggle Sidebar layout state
function toggleSidebar() {
    const sidebar = document.getElementById("app-sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    if (sidebar) {
        sidebar.classList.toggle("collapsed"); // For desktop collapse
        sidebar.classList.toggle("active");    // For mobile slide-in
    }
    if (overlay) {
        overlay.classList.toggle("active");
    }
}

// Update connection indicators/text across both desktop and mobile layouts
function updateConnectionStatus(isConnected) {
    const className = isConnected ? "dot dot-green" : "dot dot-red";
    const text = isConnected ? "Server Connected" : "Offline (Reconnecting...)";
    
    document.querySelectorAll(".connection-indicator").forEach(el => {
        el.className = `connection-indicator ${className}`;
    });
    document.querySelectorAll(".connection-text").forEach(el => {
        el.textContent = text;
    });
}

// Format API ISO date to user-friendly string
function formatISODate(isoStr) {
    if (!isoStr) return "Never";
    try {
        const d = new Date(isoStr);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + d.toLocaleDateString();
    } catch (e) {
        return isoStr;
    }
}

// Fetch and apply Settings
async function loadRawSettings() {
    try {
        const response = await fetch("/api/settings/raw");
        if (!response.ok) throw new Error("Failed to load raw settings");
        const settings = await response.json();
        
        document.getElementById("input-poll-interval").value = settings.poll_interval_seconds;
        document.getElementById("input-dry-run").checked = settings.dry_run;
        document.getElementById("input-log-level").value = settings.log_level;
        document.getElementById("cookie-copsweb02").value = settings.auth_cookie_copsweb02 || "";
        document.getElementById("cookie-copsweb021").value = settings.auth_cookie_copsweb021 || "";
        document.getElementById("cookie-session").value = settings.auth_cookie_session || "";
        
        isSettingsLoaded = true;
    } catch (e) {
        console.error(e);
        showToast("Error loading configuration settings", true);
    }
}

// Save Settings Form Submit
async function saveSettings(event) {
    event.preventDefault();
    const btn = document.getElementById("btn-save-settings");
    btn.disabled = true;
    btn.textContent = "Saving...";

    const payload = {
        poll_interval_seconds: parseInt(document.getElementById("input-poll-interval").value),
        dry_run: document.getElementById("input-dry-run").checked,
        log_level: document.getElementById("input-log-level").value,
        auth_cookie_copsweb02: document.getElementById("cookie-copsweb02").value.trim(),
        auth_cookie_copsweb021: document.getElementById("cookie-copsweb021").value.trim(),
        auth_cookie_session: document.getElementById("cookie-session").value.trim()
    };

    try {
        const response = await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || "Save failed");
        
        showToast("Configuration saved and applied.");
        pollStatus(); // Refresh state immediately
    } catch (e) {
        showToast(e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = "Save & Apply Config";
    }
}

// Poll Server Status
async function pollStatus() {
    try {
        const response = await fetch("/api/status");
        if (!response.ok) throw new Error("Offline");
        
        const data = await response.json();
        
        // Update connection status
        updateConnectionStatus(true);

        // Update scheduler UI
        const stateText = document.getElementById("scheduler-state-text");
        const pulse = document.getElementById("scheduler-pulse");
        const btnToggle = document.getElementById("btn-toggle-scheduler");

        if (data.scheduler.active) {
            stateText.textContent = data.scheduler.is_running_job ? "RUNNING SYNC" : "ACTIVE";
            stateText.className = "value badge badge-green";
            pulse.className = "pulse-indicator";
            btnToggle.textContent = "Pause Scheduler";
            btnToggle.className = "btn btn-secondary";
        } else {
            stateText.textContent = "PAUSED";
            stateText.className = "value badge badge-warning";
            pulse.className = "pulse-indicator paused";
            btnToggle.textContent = "Resume Scheduler";
            btnToggle.className = "btn btn-primary";
        }

        document.getElementById("scheduler-last-run").textContent = formatISODate(data.scheduler.last_run);
        document.getElementById("scheduler-next-run").textContent = formatISODate(data.scheduler.next_run);
        
    } catch (e) {
        // Handle connection error
        updateConnectionStatus(false);
        document.getElementById("scheduler-state-text").textContent = "DISCONNECTED";
        document.getElementById("scheduler-state-text").className = "value badge badge-warning";
        document.getElementById("scheduler-pulse").className = "pulse-indicator paused";
    }
}

// Toggle Scheduler active state
async function toggleScheduler() {
    const stateText = document.getElementById("scheduler-state-text").textContent;
    const makeActive = (stateText === "PAUSED" || stateText === "DISCONNECTED");
    
    try {
        const response = await fetch(`/api/scheduler/toggle?active=${makeActive}`, { method: "POST" });
        if (!response.ok) throw new Error("Failed to toggle scheduler");
        showToast(makeActive ? "Background scheduler started." : "Background scheduler paused.");
        pollStatus();
    } catch (e) {
        showToast(e.message, true);
    }
}

// Load flight files CSV list
async function loadCSVFiles() {
    try {
        const response = await fetch("/api/csvs");
        if (!response.ok) throw new Error("Failed to load CSVs");
        const data = await response.json();
        
        const dropdown = document.getElementById("select-csv-file");
        const filesList = document.getElementById("csv-files-list");
        
        // Reset dropdown (keep the first item)
        dropdown.innerHTML = '<option value="">-- Load CSV file --</option>';
        filesList.innerHTML = "";

        if (data.csv_files.length === 0) {
            filesList.innerHTML = '<div class="text-muted text-center py-3">No CSV files found</div>';
            return;
        }

        data.csv_files.forEach((file) => {
            // Dropdown
            const option = document.createElement("option");
            option.value = file.filename;
            option.textContent = `${file.filename} (${(file.size_bytes / 1024).toFixed(1)} KB)`;
            dropdown.appendChild(option);

            // Files List widget
            const item = document.createElement("div");
            item.className = "csv-item";
            item.innerHTML = `
                <span class="csv-name" title="${file.filename}">${file.filename}</span>
                <a href="/api/csvs/download/${file.filename}" class="csv-download" target="_blank">Download</a>
            `;
            filesList.appendChild(item);
        });
    } catch (e) {
        console.error(e);
    }
}

// Fetch flights data
async function loadFlights(filename = "") {
    const label = document.getElementById("active-file-label");
    label.textContent = "Loading flights...";
    
    const url = filename ? `/api/flights?filename=${encodeURIComponent(filename)}` : "/api/flights";
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to load flights");
        const data = await response.json();
        
        flightsList = data.flights || [];
        window.flightsList = flightsList;
        activeFile = data.filename || "None";
        
        label.textContent = activeFile !== "None" ? `Active File: ${activeFile}` : "No flight CSVs available";
        
        // Select CSV dropdown sync
        if (data.filename) {
            const dropdown = document.getElementById("select-csv-file");
            dropdown.value = data.filename;
        }

        renderFlightsTable(flightsList);
        calculateMetrics(flightsList);
    } catch (e) {
        console.error(e);
        showToast("Error loading flights list", true);
        label.textContent = "Error loading flights";
    }
}

// Select CSV file in UI
function loadSelectedCSV() {
    const val = document.getElementById("select-csv-file").value;
    loadFlights(val);
}

function formatCarts(cartsStr) {
    if (!cartsStr) return "—";
    try {
        const obj = JSON.parse(cartsStr);
        const entries = Object.entries(obj).filter(([k, v]) => v);
        if (entries.length === 0) return "—";
        return entries.map(([k, v]) => `<span class="badge badge-cyan" style="margin-right:2px; margin-bottom:2px; display:inline-block; font-size:10px;">${k}: ${v}</span>`).join("");
    } catch (e) {
        return cartsStr || "—";
    }
}

function formatDrawers(drawersStr) {
    if (!drawersStr) return "—";
    try {
        const obj = JSON.parse(drawersStr);
        const entries = Object.entries(obj).filter(([k, v]) => v);
        if (entries.length === 0) return "—";
        return entries.map(([k, v]) => `<span class="badge badge-purple" style="margin-right:2px; margin-bottom:2px; display:inline-block; font-size:10px;">${k}: ${v}</span>`).join("");
    } catch (e) {
        return drawersStr || "—";
    }
}

// Format date-time for table row: DD/MM/YYYY HH:MM
function formatDateTime(flt_dt, std) {
    if (!flt_dt) return std || "";
    let datePart = flt_dt;
    if (flt_dt.includes("T")) {
        datePart = flt_dt.split("T")[0];
    }
    if (datePart.includes("-")) {
        const parts = datePart.split("-");
        if (parts.length === 3) {
            // YYYY-MM-DD to DD/MM/YYYY
            datePart = `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
    }
    return `${datePart} ${std || ""}`.trim();
}

// Render Table Rows grouped by Route
function renderFlightsTable(flights) {
    const tbody = document.getElementById("flights-table-body");
    tbody.innerHTML = "";

    if (flights.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center text-muted py-4">
                    No matching flights found.
                </td>
            </tr>
        `;
        return;
    }

    // Group flights dynamically
    const groups = [];
    let currentGroup = null;

    flights.forEach((f) => {
        // If no current group exists, or the route changes, or it starts with sequence 1
        if (!currentGroup || f.route_no !== currentGroup.route_no || f.seq === "1") {
            currentGroup = {
                route_no: f.route_no || "",
                aircraft_type: f.aircraft_type || "",
                caterer_code: f.caterer_code || "",
                aircraft_type_id: f.aircraft_type_id || null,
                flt_no: f.flt_no,
                dep: f.dep,
                flights: []
            };
            groups.push(currentGroup);
        }
        currentGroup.flights.push(f);
    });

    groups.forEach((g) => {
        // Determine group class (green for 32P, 32W, 32Y, 32Z; brown otherwise)
        const isGreen = ["32P", "32W", "32Y", "32Z"].some(variant => g.aircraft_type.toUpperCase().includes(variant));

        const headerRow = document.createElement("tr");
        headerRow.className = `route-group-header ${isGreen ? 'green-group' : 'brown-group'}`;
        
        headerRow.innerHTML = `
            <td colspan="9">
                <div class="route-group-content">
                    <div class="route-title">
                        <svg class="plane-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block; vertical-align:middle; margin-right:6px; opacity:0.8;">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                        </svg>
                        <span>${g.aircraft_type} - Route ${g.route_no}</span>
                    </div>
                    <div class="route-actions">
                        <button class="btn-route-cart-allocation" onclick="openCartAllocationModal('${g.flt_no}', '${g.dep}', '${g.caterer_code}', '${g.aircraft_type_id}')">
                            Cart Allocation
                        </button>
                    </div>
                </div>
            </td>
        `;
        tbody.appendChild(headerRow);

        // Render each flight in the group
        g.flights.forEach((f) => {
            const row = document.createElement("tr");
            row.className = "flight-data-row";

            const dateTimeDisplay = formatDateTime(f.flt_dt, f.std);
            const flightNoDisplay = f.seq === "1" ? `${f.flt_no} Ad Hoc` : f.flt_no;
            const topUpDisplay = (f.is_top_up.toLowerCase() === "true" || f.is_top_up.toLowerCase() === "yes") 
                ? '<span class="badge badge-purple">Yes</span>' 
                : '';
            
            const categoryDisplay = f.category ? `<span class="badge badge-blue">${f.category}</span>` : '';

            row.innerHTML = `
                <td class="date-cell">${dateTimeDisplay}</td>
                <td><strong style="color: var(--primary);">${flightNoDisplay}</strong></td>
                <td class="dep-cell">${f.dep}</td>
                <td class="arr-cell">${f.arr}</td>
                <td class="seq-cell"><span class="text-muted">${f.seq}</span></td>
                <td><span class="code-font">${f.flight_type || '—'}</span></td>
                <td class="topup-cell">${topUpDisplay}</td>
                <td><span class="code-font">${f.caterer_code || '—'}</span></td>
                <td class="cat-cell">${categoryDisplay}</td>
            `;
            tbody.appendChild(row);
        });
    });
}

// Calculate Dashboard Metrics
function calculateMetrics(flights) {
    document.getElementById("metric-total-flights").textContent = flights.length;
    
    // Count "Seq 1" (first leg) DEL departures as early/primary candidate
    const seq1Count = flights.filter(f => f.seq === "1" && f.dep === "DEL").length;
    // Wait, let's also scan logs or check categories that match warnings
    document.getElementById("metric-early-flights").textContent = seq1Count;
    
    // Count Top Ups
    const topups = flights.filter(f => f.is_top_up.toLowerCase() === "true" || f.is_top_up.toLowerCase() === "yes").length;
    document.getElementById("metric-topup-flights").textContent = topups;

    // Unique Caterers
    const caterers = new Set(flights.map(f => f.caterer_code).filter(Boolean));
    document.getElementById("metric-caterers").textContent = caterers.size;
}

// Filter table in-memory
function filterFlightsTable() {
    const query = document.getElementById("input-search").value.toLowerCase().trim();
    if (!query) {
        renderFlightsTable(flightsList);
        return;
    }

    const filtered = flightsList.filter(f => {
        return (
            f.flt_no.toString().toLowerCase().includes(query) ||
            f.dep.toLowerCase().includes(query) ||
            f.arr.toLowerCase().includes(query) ||
            f.caterer_code.toLowerCase().includes(query) ||
            f.category.toLowerCase().includes(query)
        );
    });
    renderFlightsTable(filtered);
}

// Trigger Manual Sync Call
async function triggerManualSync() {
    const dateVal = document.getElementById("input-sync-date").value;
    if (!dateVal) {
        showToast("Please choose a target date first.", true);
        return;
    }

    const formattedDate = formatDateToAPI(dateVal);
    const btn = document.getElementById("btn-trigger-sync");
    
    btn.disabled = true;
    btn.textContent = "Syncing...";
    showToast(`Triggering flight fetch for ${formattedDate}...`);

    try {
        const response = await fetch("/api/trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: formattedDate })
        });
        const result = await response.json();
        
        if (!response.ok) throw new Error(result.detail || "Manual trigger failed");
        
        showToast(`Successfully synced ${result.flights_count} flights!`);
        
        // Refresh local listings and load newly created file
        await loadCSVFiles();
        await loadFlights(result.filename);
        
    } catch (e) {
        showToast(e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = "Fetch Flights";
    }
}

// Poll Logs Terminal
async function pollLogs() {
    try {
        const response = await fetch("/api/logs");
        if (!response.ok) return;
        const data = await response.json();
        
        const consoleEl = document.getElementById("logs-console");
        const logs = data.logs || [];
        
        if (logs.length === 0) return;
        
        // Only re-render if logs count increases or changes
        if (logs.length !== lastLogCount) {
            consoleEl.innerHTML = "";
            logs.forEach(line => {
                const lineEl = document.createElement("div");
                lineEl.className = "log-line";
                
                // Color codes
                if (line.includes("[ERROR]")) lineEl.classList.add("log-error");
                else if (line.includes("[WARNING]")) lineEl.classList.add("log-warn");
                else if (line.includes("[DEBUG]")) lineEl.classList.add("log-debug");
                else lineEl.classList.add("log-info");
                
                lineEl.textContent = line;
                consoleEl.appendChild(lineEl);
            });
            
            // Scroll to bottom
            consoleEl.scrollTop = consoleEl.scrollHeight;
            lastLogCount = logs.length;
        }
    } catch (e) {
        console.error("Failed to poll logs", e);
    }
}

// Clear terminal UI logs (local client representation only)
function clearTerminalLogs() {
    const consoleEl = document.getElementById("logs-console");
    consoleEl.innerHTML = '<div class="log-line text-muted">[Console] Logs cleared by user.</div>';
    lastLogCount = 0;
}



function getActiveFileDate() {
    if (!activeFile || activeFile === "None") {
        const syncVal = document.getElementById("input-sync-date").value;
        if (syncVal && syncVal.includes("/")) {
            const parts = syncVal.split("/");
            if (parts.length === 3) {
                return `${parts[0]}-${parts[1]}-${parts[2]}`; // convert DD/MM/YYYY to DD-MM-YYYY
            }
        }
        return syncVal;
    }
    const match = activeFile.match(/DEL_Flights_(.+)\.csv/);
    if (match && match[1]) {
        return match[1].replace(/-/g, "-"); // DD-MM-YYYY
    }
    return document.getElementById("input-sync-date").value;
}

let currentModalFlight = null;

async function openCartAllocationModal(flightNumber, dep, catererCode, aircraftTypeId, isRefresh = false) {
    const dateVal = getActiveFileDate();
    const modal = document.getElementById("allocation-modal");
    const modalTitle = document.getElementById("modal-flight-title");
    const modalSubtitle = document.getElementById("modal-flight-subtitle");
    
    modalTitle.textContent = `Flight ${dep}-${flightNumber} Allocation`;
    if (!isRefresh) {
        modalSubtitle.textContent = `Loading allocation details...`;
    }
    
    const fnbBody = document.getElementById("modal-fnb-carts-body");
    const mhsBody = document.getElementById("modal-mhs-carts-body");
    const devicesBody = document.getElementById("modal-devices-body");
    
    if (!isRefresh) {
        fnbBody.innerHTML = `<tr><td colspan="2" class="text-center text-muted">Loading...</td></tr>`;
        mhsBody.innerHTML = `<tr><td colspan="2" class="text-center text-muted">Loading...</td></tr>`;
        devicesBody.innerHTML = `<tr><td colspan="2" class="text-center text-muted">Loading...</td></tr>`;
    }
    
    modal.classList.remove("hidden");
    
    currentModalFlight = {
        flight_number: flightNumber,
        station: dep,
        date: dateVal,
        caterer_code: catererCode,
        aircraft_type_id: aircraftTypeId
    };
    
    try {
        const query = new URLSearchParams({
            station: dep,
            date: dateVal,
            flight_number: flightNumber,
            caterer_code: catererCode,
            aircraft_type_id: aircraftTypeId
        });
        
        const response = await fetch(`/api/flights/cart-allocation?${query.toString()}`);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || "Failed to fetch allocation details");
        }
        
        const data = await response.json();
        
        modalSubtitle.textContent = `Date: ${data.flight_date || dateVal} | Caterer: ${data.caterer || catererCode} | Aircraft Type: ${data.aircraft_type_id || aircraftTypeId}`;
        
        fnbBody.innerHTML = "";
        mhsBody.innerHTML = "";
        
        let fnbCount = 0;
        let mhsCount = 0;
        
        if (data.carts && data.carts.length > 0) {
            data.carts.forEach(cart => {
                const tr = document.createElement("tr");
                const isFilled = cart.cart_id && cart.cart_id.trim();
                const badgeClass = isFilled ? "cart-id-badge filled" : "cart-id-badge";
                
                tr.innerHTML = `
                    <td style="font-weight: 600; color: var(--text-primary); text-align: left;">${cart.type}</td>
                    <td style="text-align: left;"><span class="${badgeClass}">${cart.cart_id || "Not Allocated"}</span></td>
                `;
                
                if (cart.category === "MHS") {
                    mhsBody.appendChild(tr);
                    mhsCount++;
                } else {
                    fnbBody.appendChild(tr);
                    fnbCount++;
                }
            });
        }
        
        if (fnbCount === 0) {
            fnbBody.innerHTML = `<tr><td colspan="2" class="text-center text-muted">No FNB Carts found</td></tr>`;
        }
        if (mhsCount === 0) {
            mhsBody.innerHTML = `<tr><td colspan="2" class="text-center text-muted">No MHS Carts found</td></tr>`;
        }
        
        devicesBody.innerHTML = "";
        if (!data.devices || data.devices.length === 0) {
            devicesBody.innerHTML = `<tr><td colspan="2" class="text-center text-muted">No Devices found</td></tr>`;
        } else {
            data.devices.forEach(device => {
                const tr = document.createElement("tr");
                const hasVal = device.asset_id && device.asset_id.trim();
                const inputClass = hasVal ? "form-control device-number-input has-value" : "form-control device-number-input";
                const prefixClass = hasVal ? "device-prefix has-value" : "device-prefix";
                
                tr.innerHTML = `
                    <td style="font-weight: 600; color: var(--text-primary); text-align: left;">${device.type}</td>
                    <td style="text-align: left;">
                        <div class="device-input-group">
                            <span class="${prefixClass}">RET</span>
                            <input type="text" 
                                   class="${inputClass}" 
                                   maxlength="5" 
                                   value="${device.asset_id || ''}" 
                                   data-t-ciid="${device.t_ciid}" 
                                   data-cart-type="${device.type}"
                                   oninput="handleDeviceInput(this)"
                                   onkeypress="return event.charCode >= 48 && event.charCode <= 57">
                        </div>
                    </td>
                `;
                devicesBody.appendChild(tr);
            });
        }
        
    } catch (e) {
        showToast(e.message, true);
        modalSubtitle.textContent = `Error: ${e.message}`;
        fnbBody.innerHTML = `<tr><td colspan="2" class="text-center text-danger">Error: ${e.message}</td></tr>`;
        mhsBody.innerHTML = `<tr><td colspan="2" class="text-center text-danger">Error: ${e.message}</td></tr>`;
        devicesBody.innerHTML = `<tr><td colspan="2" class="text-center text-danger">Error: ${e.message}</td></tr>`;
    }
}

function handleDeviceInput(input) {
    // Reset styles
    input.style.borderColor = "";
    input.style.boxShadow = "";
    
    // Clear invalid validation state
    input.classList.remove("invalid");
    const prefix = input.previousElementSibling;
    if (prefix) prefix.classList.remove("invalid");
    
    const hasVal = input.value.trim().length > 0;
    if (hasVal) {
        input.classList.add("has-value");
        if (prefix) prefix.classList.add("has-value");
    } else {
        input.classList.remove("has-value");
        if (prefix) prefix.classList.remove("has-value");
    }
}

function closeAllocationModal() {
    const modal = document.getElementById("allocation-modal");
    modal.classList.add("hidden");
    currentModalFlight = null;
}

function closeAllocationModalOnOutsideClick(event) {
    if (event.target.id === "allocation-modal") {
        closeAllocationModal();
    }
}

async function submitDeviceAllocation() {
    if (!currentModalFlight) return;
    
    const btn = document.getElementById("btn-update-devices");
    btn.disabled = true;
    btn.textContent = "Updating...";
    
    const inputs = document.querySelectorAll("#modal-devices-body input");
    inputs.forEach(input => {
        input.style.borderColor = "";
        input.style.boxShadow = "";
        input.classList.remove("invalid");
        const prefix = input.previousElementSibling;
        if (prefix) prefix.classList.remove("invalid");
    });

    try {
        const allocations = [];
        
        inputs.forEach(input => {
            const t_ciid = input.getAttribute("data-t-ciid");
            const cart_type = input.getAttribute("data-cart-type");
            const rawVal = input.value.trim();
            const asset_number = rawVal ? `RET${rawVal}` : "";
            
            allocations.push({
                t_ciid: t_ciid,
                cart_type: cart_type,
                asset_number: asset_number
            });
        });
        
        const payload = {
            flight_number: currentModalFlight.flight_number,
            station: currentModalFlight.station,
            aircraft_type_id: currentModalFlight.aircraft_type_id.toString(),
            allocations: allocations
        };
        
        const response = await fetch("/api/flights/update-device-allocation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || "Update request failed");
        }
        
        const result = await response.json();
        
        if (result.Status === 1) {
            showPopup("Success", result.message || "Record(s) Updated Successfully.", false);
            // Refresh modal details
            openCartAllocationModal(
                currentModalFlight.flight_number,
                currentModalFlight.station,
                currentModalFlight.caterer_code,
                currentModalFlight.aircraft_type_id,
                true
            );
        } else {
            showPopup("Update Failed", result.message || "Failed to update allocations.", true);
            if (result.CartNumbers) {
                const failedNumbers = result.CartNumbers.split(",");
                inputs.forEach(input => {
                    const val = `RET${input.value.trim()}`;
                    if (failedNumbers.includes(val)) {
                        input.classList.add("invalid");
                        const prefix = input.previousElementSibling;
                        if (prefix) prefix.classList.add("invalid");
                    }
                });
            }
        }
        
    } catch (e) {
        showPopup("Error", e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = "Update Device";
    }
}


// --- Auto Login Interceptor ---

async function triggerAutoLogin() {
    const btn = document.getElementById("btn-auto-login");
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = "Browser Open...";
    showToast("Launching Edge/Chrome browser window. Please complete login if prompted.");
    try {
        const response = await fetch("/api/auth/automate", { method: "POST" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || "Authentication automation failed");
        showToast("Authentication cookies successfully intercepted!");
        await loadRawSettings();
    } catch (e) {
        showToast(e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = "Auto Authenticate (Browser)";
    }
}


