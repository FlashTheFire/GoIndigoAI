/* =====================================================
   bulk_upload.js  –  Bulk MPOS Upload Frontend Logic
   ===================================================== */

// ── State ──────────────────────────────────────────
let bulkParsedData = null;   // full parse response from backend
let bulkFailedRows = [];     // rows that errored, for targeted retry
let bulkCurrentStep = 1;

// ── Open / Close ───────────────────────────────────
function openBulkModal() {
    document.getElementById("bulk-modal").classList.remove("hidden");
    bulkGoToStep(1);
    bulkResetUploadTab();
}

function closeBulkModal() {
    document.getElementById("bulk-modal").classList.add("hidden");
}

// ── Step Header Click Navigation ───────────────────
function bulkClickStep(n) {
    if (n === 1) {
        bulkGoToStep(1);
    } else if (n === 2) {
        if (bulkParsedData) {
            bulkGoToStep(2);
        } else {
            bulkShowError("Please upload or paste a table to parse first.");
        }
    } else if (n === 3) {
        if (bulkParsedData) {
            bulkGoToStep(3);
        } else {
            bulkShowError("Please upload or paste a table to parse first.");
        }
    }
}

// ── Step navigation ────────────────────────────────
function bulkGoToStep(n) {
    bulkCurrentStep = n;
    // Expand modal to full-width for Step 3 (Processing & Results)
    const modalCard = document.querySelector(".bulk-modal-card");
    if (modalCard) modalCard.classList.toggle("step3-expanded", n === 3);
    document.querySelectorAll(".bulk-step-panel").forEach((p, i) => {
        p.classList.toggle("active", i + 1 === n);
    });
    document.querySelectorAll(".bulk-step").forEach((s, i) => {
        s.classList.remove("active", "done");
        if (i + 1 === n) s.classList.add("active");
        else if (i + 1 < n) s.classList.add("done");
    });
    // Footer buttons
    document.getElementById("btn-bulk-back").style.display = n > 1 && n < 3 ? "inline-flex" : "none";
    document.getElementById("btn-bulk-confirm").style.display = n === 2 ? "inline-flex" : "none";
    document.getElementById("btn-bulk-retry").style.display = n === 3 && bulkFailedRows.length > 0 ? "inline-flex" : "none";
    document.getElementById("btn-bulk-close2").style.display = n === 3 ? "inline-flex" : "none";
}

// ── Tab switching (File / Paste) ───────────────────
function bulkSwitchTab(tab) {
    document.querySelectorAll(".bulk-tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".bulk-tab-pane").forEach(p => p.classList.toggle("active", p.id === `bulk-tab-${tab}`));
}

// ── Drag & Drop ────────────────────────────────────
function bulkSetupDrop() {
    const zone = document.getElementById("bulk-drop-zone");
    if (!zone) return;
    zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("drag-over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", e => {
        e.preventDefault();
        zone.classList.remove("drag-over");
        const file = e.dataTransfer.files[0];
        if (file) bulkHandleFile(file);
    });
}

function bulkOnFileInput(input) {
    if (input.files[0]) bulkHandleFile(input.files[0]);
}

function bulkResetUploadTab() {
    document.getElementById("bulk-drop-filename").style.display = "none";
    document.getElementById("bulk-drop-filename").textContent = "";
    document.getElementById("bulk-paste-area").value = "";
    document.getElementById("bulk-warnings").classList.remove("show");
    document.getElementById("bulk-warnings").innerHTML = "";
    const btn = document.getElementById("btn-bulk-parse");
    btn.disabled = false; btn.innerHTML = "Parse →";
    bulkSwitchTab("file");
}

// ── File handling ──────────────────────────────────
async function bulkHandleFile(file) {
    const allowed = ["jpg", "jpeg", "png", "webp", "pdf", "xlsx", "xls", "csv"];
    const ext = file.name.split(".").pop().toLowerCase();
    if (!allowed.includes(ext)) {
        bulkShowError(`Unsupported file type: .${ext}`);
        return;
    }
    document.getElementById("bulk-drop-filename").textContent = `📎 ${file.name}`;
    document.getElementById("bulk-drop-filename").style.display = "block";

    const btn = document.getElementById("btn-bulk-parse");
    btn.disabled = true;
    btn.innerHTML = `<span class="bulk-spinner"></span>&nbsp; Parsing...`;

    try {
        const formData = new FormData();
        formData.append("file", file);
        const resp = await fetch("/api/bulk/parse-file", { method: "POST", body: formData });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ detail: "Unknown error" }));
            throw new Error(err.detail || "Parse failed");
        }
        bulkParsedData = await resp.json();
        bulkBuildConfirmStep();
        bulkGoToStep(2);
    } catch (e) {
        bulkShowError(e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = "Parse →";
    }
}

async function bulkPasteAndParse() {
    const text = document.getElementById("bulk-paste-area").value.trim();
    if (!text) { bulkShowError("Please paste a table first."); return; }

    const btn = document.getElementById("btn-bulk-parse-paste");
    btn.disabled = true;
    btn.innerHTML = `<span class="bulk-spinner"></span>&nbsp; Parsing...`;

    try {
        const resp = await fetch("/api/bulk/parse-text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ detail: "Unknown error" }));
            throw new Error(err.detail || "Parse failed");
        }
        bulkParsedData = await resp.json();
        bulkBuildConfirmStep();
        bulkGoToStep(2);
    } catch (e) {
        bulkShowError(e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = "Parse →";
    }
}

// ── Build confirm step ─────────────────────────────
function bulkBuildConfirmStep() {
    const d = bulkParsedData;

    // Detected info
    document.getElementById("bulk-confirm-date").value = d.shift_date || "";
    document.getElementById("bulk-confirm-shift").value = d.shift_label || "";
    // Station dropdown — default DEL
    const stationSel = document.getElementById("bulk-confirm-station");
    stationSel.innerHTML = "";
    const stations = d.stations || ["DEL", "BOM", "BLR", "HYD", "MAA", "CCU", "AMD", "COK", "PNQ", "GOI", "JAI", "LKO"];
    stations.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s; opt.textContent = s;
        if (s === "DEL") opt.selected = true;
        stationSel.appendChild(opt);
    });

    // Warnings — show on both step 1 footer and step 2 confirm
    const warnEl = document.getElementById("bulk-warnings");
    const warnEl2 = document.getElementById("bulk-warnings-confirm");
    if (d.parse_warnings && d.parse_warnings.length > 0) {
        const warnHtml = `<strong>⚠ Parse Warnings:</strong><ul>${d.parse_warnings.map(w => `<li>${w}</li>`).join("")}</ul>`;
        if (warnEl) { warnEl.innerHTML = warnHtml; warnEl.classList.add("show"); }
        if (warnEl2) { warnEl2.innerHTML = warnHtml; warnEl2.classList.add("show"); }
    } else {
        if (warnEl) warnEl.classList.remove("show");
        if (warnEl2) warnEl2.classList.remove("show");
    }

    // Preview table
    const positions = _bulkGetPositionCols(d.rows || []);
    const thead = document.getElementById("bulk-preview-thead");
    const tbody = document.getElementById("bulk-preview-tbody");
    const summary = document.getElementById("bulk-confirm-summary");

    thead.innerHTML = `<tr>
        <th>SNO</th><th>Flight No</th>
        ${positions.map(p => `<th>${p}</th>`).join("")}
        <th>Status</th>
    </tr>`;

    let processCount = 0, skipCount = 0;
    tbody.innerHTML = "";

    (d.rows || []).forEach(row => {
        const willSkip = !!row.skip_reason;
        if (willSkip) skipCount++; else processCount++;

        const tr = document.createElement("tr");
        tr.className = willSkip ? "row-skip" : "row-process";

        const posCells = positions.map(pos => {
            const v = row.positions?.[pos];
            if (v === null || v === undefined) return `<td><span class="cell-unclear">○ skip</span></td>`;
            if (v === "") return `<td><span class="cell-empty">—</span></td>`;
            return `<td><span class="cell-valid">RET${v}</span></td>`;
        }).join("");

        const statusBadge = willSkip
            ? `<span class="badge badge-warning">${row.skip_reason === "all_empty" ? "Skip (empty)" : "Skip"}</span>`
            : `<span class="badge badge-green">Will Process</span>`;

        tr.innerHTML = `
            <td>${row.sno ?? "—"}</td>
            <td style="font-weight:700">${row.flight_no ?? "—"}</td>
            ${posCells}
            <td>${statusBadge}</td>`;
        tbody.appendChild(tr);
    });

    summary.textContent = `${processCount} flights to process · ${skipCount} skipped`;
}

function _bulkGetPositionCols(rows) {
    const posSet = new Set();
    rows.forEach(r => { if (r.positions) Object.keys(r.positions).forEach(p => posSet.add(p)); });
    const order = ["L1", "L2", "L3", "L4", "R1", "R2", "R3", "R4", "STDBY1", "STDBY2"];
    return [...posSet].sort((a, b) => {
        const ai = order.indexOf(a), bi = order.indexOf(b);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.localeCompare(b);
    });
}

// ── Step 3 State & View Config ──────────────────────
const POSITION_COLS = ["L1", "L2", "L3", "L4", "R1", "R2", "R3", "R4", "STDBY1", "STDBY2"];
let bulkProViewActive = true;
let bulkFlightExecutionState = {};
let bulkSleepTimeouts = {};
let bulkStep3Filter = "all";
let bulkStep3Search = "";
let bulkLogFilter = "all";
let bulkExecutionMode = "auto";
let bulkInspectIndex = 0;
let bulkInspectFlightNo = null;
let bulkManualRows = [];
let bulkManualCurrentIndex = 0;
let bulkAutomationRunning = false;
let bulkLogLines = [];

function bulkToggleProView(checked) {
    bulkProViewActive = checked;
    bulkRenderStep3Table();
}

function bulkRenderStep3Table() {
    const thead = document.getElementById("bulk-live-thead");
    const tbody = document.getElementById("bulk-live-table-body");
    if (!thead || !tbody) return;

    // 1. Headers
    if (bulkProViewActive) {
        thead.innerHTML = `<tr>
            <th>Flight No</th>
            <th>L1</th><th>L2</th><th>L3</th><th>L4</th>
            <th>R1</th><th>R2</th><th>R3</th><th>R4</th>
            <th>STDBY1</th><th>STDBY2</th>
            <th>Status</th>
        </tr>`;
    } else {
        thead.innerHTML = `<tr>
            <th>Flight No</th>
            <th>Target Allocations</th>
            <th>Portal Devices (Before)</th>
            <th>Result / Status</th>
        </tr>`;
    }

    // 2. Body
    tbody.innerHTML = "";
    Object.keys(bulkFlightExecutionState).forEach(flight_no => {
        const state = bulkFlightExecutionState[flight_no];
        const tr = document.createElement("tr");
        tr.id = `bulk-live-row-${flight_no}`;
        tr.style.cursor = "pointer";
        tr.onclick = () => bulkInspectFlight(flight_no);
        tbody.appendChild(tr);
        bulkUpdateFlightRow(flight_no);
    });
}

function bulkUpdateFlightRow(flight_no) {
    const state = bulkFlightExecutionState[flight_no];
    const tr = document.getElementById(`bulk-live-row-${flight_no}`);
    if (!state || !tr) return;

    // Determine row class based on status
    tr.className = "";
    if (state.status === "processing" || state.status === "sleeping") {
        tr.classList.add("row-processing-active");
    } else if (state.status === "skipped") {
        tr.classList.add("row-skip");
    }

    // Generate status badge/html
    let statusHtml = "";
    if (state.status === "pending") {
        statusHtml = `<span class="badge badge-secondary">⏳ Pending</span>`;
    } else if (state.status === "skipped") {
        statusHtml = `<span class="badge badge-warning" style="opacity:0.7;">⏭ Skipped</span>`;
    } else if (state.status === "not_found") {
        statusHtml = `<span class="badge badge-warning">🔍 Not Found</span>`;
    } else if (state.status === "processing") {
        statusHtml = `<span class="badge badge-blue"><span class="bulk-spinner" style="width:10px; height:10px; border-width:1.5px; vertical-align:middle; margin-right:4px;"></span> Fetching...</span>`;
    } else if (state.status === "sleeping") {
        statusHtml = `<span class="badge badge-purple" style="animation: pulse 1s infinite;">⏳ Wait ${state.countdown}s</span>`;
    } else if (state.status === "success") {
        statusHtml = `<span class="badge badge-green">✅ Success</span>`;
    } else if (state.status === "failed") {
        if (state.status_message && (state.status_message.includes("Retry succeeded") || state.status_message.includes("cleared and saved"))) {
            statusHtml = `<span class="badge badge-warning" title="${state.status_message}">⚠️ Auto-cleared</span>`;
        } else {
            statusHtml = `<span class="badge badge-red" title="${state.status_message || ''}">❌ Failed</span>`;
        }
    }

    if (bulkProViewActive) {
        // --- PRO GRID VIEW ---
        const colsHtml = POSITION_COLS.map(pos => {
            const plannedVal = state.positions[pos]; // e.g. "20270"
            const portalValRaw = state.portal_devices?.[pos] || ""; // e.g. "RET21942" or "21942"
            const portalVal = portalValRaw.replace(/^RET/, "");
            const finalValRaw = state.final_allocations?.[pos] || ""; // e.g. "RET20270"
            const finalVal = finalValRaw.replace(/^RET/, "");

            // Case A: Skip row
            if (state.status === "skipped") {
                return `<td><span class="cell-empty">—</span></td>`;
            }

            // Case B: Pending, Processing, or Sleeping (show planned target to set)
            if (state.status === "pending" || state.status === "processing" || state.status === "sleeping") {
                if (plannedVal) {
                    return `<td><span class="cell-unclear" style="color: var(--text-muted);">→ RET${plannedVal}</span></td>`;
                }
                return `<td><span class="cell-empty">—</span></td>`;
            }

            // Case C: Success or Failed (show before / after transition)
            if (plannedVal) {
                const oldText = portalVal ? portalVal : "—";
                const newText = finalVal ? finalVal : "—";
                const posSucceeded = (state.status === "success") || (state.status === "failed" && finalVal === plannedVal && finalVal !== "");
                const newClass = posSucceeded ? "device-new" : "device-old";
                return `<td>
                    <div class="device-diff-badge">
                        <span class="device-old">${oldText}</span>
                        <span class="device-arrow">→</span>
                        <span class="device-new ${newClass}">${newText}</span>
                    </div>
                </td>`;
            } else {
                // No modification planned, just show portal device if existed
                if (portalVal) {
                    return `<td><span class="cell-empty" style="color: var(--text-muted); opacity: 0.65;">RET${portalVal}</span></td>`;
                }
                return `<td><span class="cell-empty">—</span></td>`;
            }
        }).join("");

        tr.innerHTML = `
            <td style="font-weight: 700;">${state.flight_no}</td>
            ${colsHtml}
            <td class="status-cell">${statusHtml}</td>
        `;
    } else {
        // --- STANDARD COMPACT VIEW ---
        // 1. Target Allocations Column
        const targets = [];
        if (state.positions) {
            for (const [pos, val] of Object.entries(state.positions)) {
                if (val) targets.push(`<span class="pos-label-badge">${pos}</span>RET${val}`);
            }
        }
        const targetsHtml = targets.length > 0 ? targets.join(" ") : `<span class="cell-empty">—</span>`;

        // 2. Portal Devices (Before) Column
        let portalHtml = "";
        if (state.status === "pending" || (state.status === "processing" && !state.portal_devices)) {
            portalHtml = `<span class="text-muted" style="font-style: italic;">⏳ Querying...</span>`;
        } else if (state.status === "skipped") {
            portalHtml = `<span class="cell-empty">—</span>`;
        } else {
            const devList = [];
            if (state.portal_devices) {
                for (const [pos, val] of Object.entries(state.portal_devices)) {
                    if (val) {
                        const cleanVal = val.replace(/^RET/, "");
                        devList.push(`<span class="pos-label-badge" style="opacity: 0.6;">${pos}</span><span style="opacity: 0.8;">RET${cleanVal}</span>`);
                    }
                }
            }
            portalHtml = devList.length > 0 ? devList.join(" ") : `<span class="cell-empty">None (All Clear)</span>`;
        }

        tr.innerHTML = `
            <td style="font-weight: 700;">${state.flight_no}</td>
            <td>${targetsHtml}</td>
            <td><div style="display:flex; flex-wrap:wrap; gap:4px;">${portalHtml}</div></td>
            <td class="status-cell">${statusHtml}</td>
        `;
    }
}

// ── Run automation ─────────────────────────────────
async function bulkRunAutomation(rowsOverride = null) {
    if (!bulkParsedData) return;

    const station = document.getElementById("bulk-confirm-station").value;
    const dateVal = document.getElementById("bulk-confirm-date").value;
    const shiftVal = document.getElementById("bulk-confirm-shift").value;

    if (!dateVal) { alert("Please enter a shift date before continuing."); return; }

    bulkGoToStep(3);
    bulkFailedRows = [];
    bulkAutomationRunning = true;
    bulkLogLines = [];

    const feed = document.getElementById("bulk-live-feed");
    const progWrap = document.getElementById("bulk-progress-wrap");
    const progBar = document.getElementById("bulk-progress-bar");
    const summary = document.getElementById("bulk-summary");

    feed.innerHTML = "";
    summary.classList.remove("show");
    progWrap.classList.add("show");
    progBar.style.width = "0%";

    document.getElementById("btn-bulk-retry").style.display = "none";
    document.getElementById("btn-bulk-close2").style.display = "none";

    const rows = rowsOverride || bulkParsedData.rows || [];

    // Pre-populate execution state
    bulkFlightExecutionState = {};
    Object.values(bulkSleepTimeouts).forEach(clearInterval);
    bulkSleepTimeouts = {};
    bulkStep3Filter = "all";
    bulkStep3Search = "";
    bulkLogFilter = "all";

    // Reset filter button states in UI
    ["all", "success", "failed", "skipped"].forEach(f => {
        const btn = document.getElementById(`btn-filter-${f}`);
        if (btn) btn.classList.toggle("active", f === "all");
    });
    const logAll = document.getElementById("log-filter-all");
    const logWarn = document.getElementById("log-filter-warnings");
    if (logAll) logAll.classList.add("active");
    if (logWarn) logWarn.classList.remove("active");

    // Reset SVG Cabin LEDs
    const telemetryText = document.getElementById("svg-telemetry-text");
    if (telemetryText) {
        telemetryText.textContent = "SYSTEM IDLE";
        telemetryText.style.color = "#4f72f5";
    }
    POSITION_COLS.forEach(pos => {
        const led = document.querySelector(`#svg-door-${pos} .door-status-led`);
        if (led) led.className = "door-status-led led-inactive";
    });

    rows.forEach(row => {
        bulkFlightExecutionState[row.flight_no] = {
            sno: row.sno,
            flight_no: row.flight_no,
            positions: row.positions || {},
            skip_reason: row.skip_reason || null,
            status: row.skip_reason ? "skipped" : "pending",
            status_message: "",
            countdown: 0,
            portal_devices: null,
            final_allocations: null
        };
    });

    // Render Table immediately
    bulkRenderStep3Table();
    bulkUpdateStatsCards();
    bulkApplyStep3Filters();
    bulkUpdateHeatmapGraph();

    if (bulkExecutionMode === "review") {
        // --- USER-REVIEW FLOW ---
        bulkManualRows = rows;
        _bulkAddFeed("warn", "Starting User-Review automation. Each flight requires manual approval.");
        bulkRunManualReviewStep(0);
        return;
    }

    // --- AUTO-PILOT STREAM FLOW ---
    const payload = {
        station,
        date: dateVal,
        shift_label: shiftVal || null,
        rows
    };

    let totalProcessable = rows.filter(r => !r.skip_reason).length;
    let processed = 0;

    try {
        const resp = await fetch("/api/bulk/process", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            _bulkAddFeed("warn", `Request failed: ${err.detail || resp.statusText}`);
            bulkAutomationRunning = false;
            return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const parts = buffer.split("\n\n");
            buffer = parts.pop(); // keep incomplete part

            for (const part of parts) {
                if (!part.trim()) continue;
                const lines = part.split("\n");
                let eventType = "message", dataStr = "";
                for (const line of lines) {
                    if (line.startsWith("event: ")) eventType = line.slice(7).trim();
                    else if (line.startsWith("data: ")) dataStr = line.slice(6).trim();
                }
                if (!dataStr) continue;
                try {
                    const data = JSON.parse(dataStr);

                    // Route live events to log feed console
                    _bulkHandleEvent(eventType, data, feed, progBar, totalProcessable, processed);

                    const flight_no = data.flight_no;
                    if (flight_no && bulkFlightExecutionState[flight_no]) {
                        const state = bulkFlightExecutionState[flight_no];

                        if (eventType === "flight_start") {
                            state.status = "processing";
                            bulkUpdateFlightRow(flight_no);
                            bulkInspectFlight(flight_no);
                        }
                        else if (eventType === "portal_data") {
                            state.portal_devices = {};
                            if (data.devices) {
                                state.devices_raw = data.devices;
                                data.devices.forEach(d => {
                                    state.portal_devices[d.type] = d.asset_id;
                                });
                            }
                            state.carts_raw = data.carts || [];
                            state.flight_meta = data.flight_meta || {};
                            state.fetch_raw_response = data;
                            state.status = "processing";
                            bulkUpdateFlightRow(flight_no);
                            bulkInspectFlight(flight_no);
                        }
                        else if (eventType === "sleep_start") {
                            // Don't overwrite a flight that already has a terminal status
                            // The anti-bot sleep fires for the SAME flight that just succeeded
                            if (state.status !== "success" && state.status !== "failed") {
                                state.status = "sleeping";
                            }
                            state.countdown = data.duration;

                            if (bulkSleepTimeouts[flight_no]) {
                                clearInterval(bulkSleepTimeouts[flight_no]);
                            }
                            bulkSleepTimeouts[flight_no] = setInterval(() => {
                                state.countdown = Math.max(0, (state.countdown - 0.1).toFixed(1));
                                bulkUpdateFlightRow(flight_no);
                                bulkUpdateSvgCabin(flight_no, "sleep_tick", { duration: state.countdown });
                                bulkUpdateStatsCards();
                                if (state.countdown <= 0) {
                                    clearInterval(bulkSleepTimeouts[flight_no]);
                                    delete bulkSleepTimeouts[flight_no];
                                }
                            }, 100);

                            bulkUpdateFlightRow(flight_no);
                            bulkInspectFlight(flight_no);
                        }
                        else if (eventType === "flight_success") {
                            if (bulkSleepTimeouts[flight_no]) {
                                clearInterval(bulkSleepTimeouts[flight_no]);
                                delete bulkSleepTimeouts[flight_no];
                            }
                            state.status = "success";
                            state.final_allocations = data.positions_sent || {};
                            state.server_response = data.server_response || null;
                            bulkUpdateFlightRow(flight_no);
                            bulkInspectFlight(flight_no);
                            bulkUpdateHeatmapGraph();
                        }
                        else if (eventType === "flight_retry_success") {
                            if (bulkSleepTimeouts[flight_no]) {
                                clearInterval(bulkSleepTimeouts[flight_no]);
                                delete bulkSleepTimeouts[flight_no];
                            }
                            state.status = "failed";
                            state.status_message = data.message || "Auto-restored to original portal values.";
                            state.final_allocations = data.positions_sent || {};
                            state.server_response = data.server_response || null;
                            state.restored_to_original = data.restored_to_original || {};
                            state.had_auto_retry = true;
                            bulkUpdateFlightRow(flight_no);
                            bulkInspectFlight(flight_no);
                            bulkUpdateHeatmapGraph();
                        }
                        else if (eventType === "flight_error" || eventType === "flight_retry_failed") {
                            if (bulkSleepTimeouts[flight_no]) {
                                clearInterval(bulkSleepTimeouts[flight_no]);
                                delete bulkSleepTimeouts[flight_no];
                            }
                            state.status = "failed";
                            state.status_message = data.message;
                            state.server_response = data.server_response || null;
                            bulkUpdateFlightRow(flight_no);
                            bulkInspectFlight(flight_no);
                        }
                        else if (eventType === "flight_retry") {
                            state.status = "processing";
                            state.status_message = data.message;
                            bulkUpdateFlightRow(flight_no);
                            bulkInspectFlight(flight_no);
                        }
                        else if (eventType === "flight_skipped") {
                            state.status = "skipped";
                            state.skip_reason = data.reason;
                            bulkUpdateFlightRow(flight_no);
                            bulkInspectFlight(flight_no);
                        }
                        else if (eventType === "flight_not_found") {
                            state.status = "not_found";
                            bulkUpdateFlightRow(flight_no);
                            bulkInspectFlight(flight_no);
                        }

                        bulkUpdateSvgCabin(flight_no, eventType, data);
                        bulkUpdateStatsCards();
                        bulkApplyStep3Filters();
                    }

                    if (["flight_success", "flight_retry_success", "flight_retry_failed", "flight_not_found"].includes(eventType)) {
                        processed++;
                        progBar.style.width = `${Math.min(100, Math.round((processed / totalProcessable) * 100))}%`;
                    }
                    if (eventType === "summary") _bulkRenderSummary(data, summary);
                    if (eventType === "done") {
                        progBar.style.width = "100%";
                        bulkAutomationRunning = false;
                        document.getElementById("btn-bulk-close2").style.display = "inline-flex";
                        if (bulkFailedRows.length > 0)
                            document.getElementById("btn-bulk-retry").style.display = "inline-flex";
                    }
                    if (["flight_error", "flight_retry_success", "flight_retry_failed", "flight_not_found"].includes(eventType)) {
                        const matchRow = (bulkParsedData.rows || []).find(r => r.flight_no == data.flight_no);
                        if (matchRow && !bulkFailedRows.includes(matchRow)) bulkFailedRows.push(matchRow);
                    }
                } catch (_) { }
            }
        }
    } catch (e) {
        _bulkAddFeed("warn", `Stream error: ${e.message}`);
    }
}

function _bulkHandleEvent(type, data, feed, _bar, _total, _processed) {
    switch (type) {
        case "flight_start":
            _bulkAddFeed("start", `Processing Flight <span class="flt">${data.flight_no}</span> (SNO ${data.sno ?? "—"}) [${data.index}/${data.total}]...`, feed);
            break;
        case "portal_data": {
            const devList = (data.devices || []).map(d => `${d.type}: ${d.asset_id || "None"}`).join(", ");
            _bulkAddFeed("info", `Flight <span class="flt">${data.flight_no}</span> — Portal data fetched: [${devList}], Carts: ${(data.carts || []).length}`, feed);
            break;
        }
        case "flight_success": {
            const sentList = Object.entries(data.positions_sent || {}).map(([pos, val]) => `${pos}➔${val}`).join(", ");
            const respMsg = data.server_response ? (data.server_response.message || JSON.stringify(data.server_response)) : data.message;
            _bulkAddFeed("success", `Flight <span class="flt">${data.flight_no}</span>${data.dry_run ? " [DRY RUN]" : ""} — Saved: [${sentList}]. API Response: "${respMsg}"`, feed);
            break;
        }
        case "flight_error": {
            const errResp = data.server_response ? JSON.stringify(data.server_response) : "None";
            _bulkAddFeed("error", `Flight <span class="flt">${data.flight_no}</span> — Error: ${data.message}. API Response: ${errResp}`, feed);
            break;
        }
        case "flight_retry": {
            const restored = data.restored_to_original || {};
            const restoredList = Object.entries(restored).map(([pos, val]) => `${pos}→${val || 'empty'}`).join(", ");
            _bulkAddFeed("retry", `Flight <span class="flt">${data.flight_no}</span> — Auto-retrying: restoring [${restoredList}] to original portal values...`, feed);
            break;
        }
        case "flight_retry_success": {
            const restored = data.restored_to_original || {};
            const restoredList = Object.entries(restored).map(([pos, val]) => `<span class="pos-err">${pos}→${val || 'empty'}</span>`).join(", ");
            _bulkAddFeed("retryok", `Flight <span class="flt">${data.flight_no}</span> — ⚠ PARTIAL FAIL: Invalid positions restored to original portal values [${restoredList}]. Data preserved, manual fix required.`, feed);
            break;
        }
        case "flight_retry_failed": {
            const errResp = data.server_response ? JSON.stringify(data.server_response) : "None";
            _bulkAddFeed("retryfail", `Flight <span class="flt">${data.flight_no}</span> — Retry Failed: ${data.message}. API Response: ${errResp}`, feed);
            break;
        }
        case "flight_skipped":
            _bulkAddFeed("skip", `Flight <span class="flt">${data.flight_no ?? "—"}</span> — Skipped (${data.reason})`, feed);
            break;
        case "flight_not_found":
            _bulkAddFeed("notfound", `Flight <span class="flt">${data.flight_no}</span> — Not found in CSV for station ${data.station || ""}`, feed);
            break;
        case "warning":
            _bulkAddFeed("warn", data.message, feed);
            break;
    }
    // Scroll feed to bottom
    const feedEl = feed || document.getElementById("bulk-live-feed");
    feedEl.scrollTop = feedEl.scrollHeight;
}

function _bulkAddFeed(type, htmlMsg, feedEl) {
    const el = feedEl || document.getElementById("bulk-live-feed");
    const div = document.createElement("div");
    div.className = `feed-entry entry-${type}`;
    div.dataset.type = type;
    div.innerHTML = `<span class="feed-icon"></span><span class="feed-msg">${htmlMsg}</span>`;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;

    // Save plain text version for log export
    const textMsg = div.textContent.trim();
    const timestamp = new Date().toLocaleTimeString();
    bulkLogLines.push(`[${timestamp}] [${type.toUpperCase()}] ${textMsg}`);

    if (typeof bulkApplyLogFilterToElement === "function") {
        bulkApplyLogFilterToElement(div);
    }
}

function _bulkRenderSummary(data, summaryEl) {
    summaryEl.innerHTML = `
        <div class="summary-title">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            Automation Complete
            ${data.shift_label ? `<span class="badge badge-blue" style="margin-left:8px">${data.shift_label} SHIFT</span>` : ""}
            ${data.dry_run ? `<span class="badge badge-warning" style="margin-left:4px">DRY RUN</span>` : ""}
        </div>
        <div class="summary-chips">
            <div class="summary-chip chip-success">
                <span class="chip-count">${data.success}</span>
                <span class="chip-label">✅ Success</span>
            </div>
            <div class="summary-chip chip-retry">
                <span class="chip-count">${data.retry_cleared}</span>
                <span class="chip-label">⚠️ Restored (Error)</span>
            </div>
            <div class="summary-chip chip-skip">
                <span class="chip-count">${data.skipped}</span>
                <span class="chip-label">⏭ Skipped</span>
            </div>
            <div class="summary-chip chip-notfound">
                <span class="chip-count">${data.not_found}</span>
                <span class="chip-label">🔍 Not Found</span>
            </div>
            <div class="summary-chip chip-error">
                <span class="chip-count">${data.error}</span>
                <span class="chip-label">❌ Errors</span>
            </div>
        </div>`;
    summaryEl.classList.add("show");
}

// ── Retry only failed ──────────────────────────────
function bulkRetryFailed() {
    if (!bulkFailedRows.length) return;
    const rows = [...bulkFailedRows];
    bulkFailedRows = [];
    bulkRunAutomation(rows);
}

// ── Error helper ───────────────────────────────────
function bulkShowError(msg) {
    const warnEl = document.getElementById("bulk-warnings");
    warnEl.innerHTML = `<strong>❌ Error:</strong> ${msg}`;
    warnEl.classList.add("show");
}

// ── Init on DOM ready ──────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    bulkSetupDrop();
});

// ── Futuristic Step 3 Features, Telemetry & Inspector ───────────────────

function bulkSetExecutionMode(mode) {
    if (bulkAutomationRunning) {
        showToast("Cannot switch execution mode while automation is running.", true);

        // Revert select dropdown element to the currently executing mode
        const select = document.getElementById("bulk-execution-mode-select");
        if (select) select.value = bulkExecutionMode;
        return;
    }
    bulkExecutionMode = mode;
    const btnAuto = document.getElementById("btn-mode-auto");
    const btnReview = document.getElementById("btn-mode-review");
    if (btnAuto) btnAuto.classList.toggle("active", mode === "auto");
    if (btnReview) btnReview.classList.toggle("active", mode === "review");

    const select = document.getElementById("bulk-execution-mode-select");
    if (select) select.value = mode;
}

function bulkFilterStep3(filterVal) {
    bulkStep3Filter = filterVal;
    const filters = ["all", "success", "failed", "skipped"];
    filters.forEach(f => {
        const btn = document.getElementById(`btn-filter-${f}`);
        if (btn) btn.classList.toggle("active", f === filterVal);
    });
    bulkApplyStep3Filters();
}

function bulkSearchStep3(query) {
    bulkStep3Search = query.toLowerCase().trim();
    bulkApplyStep3Filters();
}

function bulkApplyStep3Filters() {
    Object.keys(bulkFlightExecutionState).forEach(flight_no => {
        const state = bulkFlightExecutionState[flight_no];
        const tr = document.getElementById(`bulk-live-row-${flight_no}`);
        if (!state || !tr) return;

        let matchFilter = true;
        if (bulkStep3Filter === "success") {
            matchFilter = (state.status === "success");
        } else if (bulkStep3Filter === "failed") {
            matchFilter = (state.status === "failed" || state.status === "not_found");
        } else if (bulkStep3Filter === "skipped") {
            matchFilter = (state.status === "skipped");
        }

        let matchSearch = true;
        if (bulkStep3Search) {
            matchSearch = flight_no.toLowerCase().includes(bulkStep3Search);
        }

        tr.style.display = (matchFilter && matchSearch) ? "" : "none";
    });
}

function bulkFilterLogs(level) {
    bulkLogFilter = level;
    const btnAll = document.getElementById("log-filter-all");
    const btnWarn = document.getElementById("log-filter-warnings");
    if (btnAll) btnAll.classList.toggle("active", level === "all");
    if (btnWarn) btnWarn.classList.toggle("active", level === "warn");

    const feed = document.getElementById("bulk-live-feed");
    if (feed) {
        feed.querySelectorAll(".feed-entry").forEach(entry => {
            bulkApplyLogFilterToElement(entry);
        });
    }
}

function bulkApplyLogFilterToElement(entry) {
    if (bulkLogFilter === "all") {
        entry.style.display = "";
    } else {
        const type = entry.dataset.type;
        const isWarnOrErr = ["error", "retry", "retryok", "retryfail", "notfound", "warn"].includes(type);
        entry.style.display = isWarnOrErr ? "" : "none";
    }
}

function bulkFixFlight(flight_no) {
    const cleanNo = flight_no.replace(/\D/g, "").replace(/^0+/, "");
    const match = (window.flightsList || []).find(f => {
        const fNo = String(f.flt_no || f.Flt_No || "").replace(/\D/g, "").replace(/^0+/, "");
        return fNo === cleanNo;
    });

    if (match) {
        if (typeof openCartAllocationModal === "function") {
            openCartAllocationModal(
                match.flt_no || match.Flt_No,
                match.dep || match.Dep || "DEL",
                match.caterer_code || match.Caterer_Code || "",
                match.aircraft_type_id || match.AircraftTypeId || ""
            );
        }
    } else {
        const station = document.getElementById("bulk-confirm-station").value || "DEL";
        if (typeof openCartAllocationModal === "function") {
            openCartAllocationModal(flight_no, station, "", "");
        }
    }
}

function bulkInspectPrev() {
    const flightNumbers = Object.keys(bulkFlightExecutionState);
    if (flightNumbers.length === 0) return;
    let idx = flightNumbers.indexOf(bulkInspectFlightNo);
    if (idx === -1) idx = 0;
    const prevIdx = (idx - 1 + flightNumbers.length) % flightNumbers.length;
    bulkInspectFlight(flightNumbers[prevIdx]);
}

function bulkInspectNext() {
    const flightNumbers = Object.keys(bulkFlightExecutionState);
    if (flightNumbers.length === 0) return;
    let idx = flightNumbers.indexOf(bulkInspectFlightNo);
    if (idx === -1) idx = 0;
    const nextIdx = (idx + 1) % flightNumbers.length;
    bulkInspectFlight(flightNumbers[nextIdx]);
}

function bulkInspectFlight(flight_no) {
    bulkInspectFlightNo = flight_no;
    const state = bulkFlightExecutionState[flight_no];
    if (!state) return;

    // Highlight row in table
    document.querySelectorAll(".bulk-live-table tr").forEach(r => r.classList.remove("inspect-active"));
    const rowEl = document.getElementById(`bulk-live-row-${flight_no}`);
    if (rowEl) rowEl.classList.add("inspect-active");

    // Title
    const titleEl = document.getElementById("inspect-flight-title");
    if (titleEl) titleEl.textContent = `Flight ${flight_no}`;

    // Status badge
    const badge = document.getElementById("inspect-flight-status-badge");
    if (badge) {
        badge.textContent = state.status.toUpperCase();
        badge.className = `badge`;
        if (state.status === "success") badge.classList.add("badge-green");
        else if (state.status === "failed") badge.classList.add("badge-red");
        else if (state.status === "skipped") badge.classList.add("badge-warning");
        else if (state.status === "processing") badge.classList.add("badge-blue");
        else if (state.status === "sleeping") badge.classList.add("badge-purple");
        else badge.classList.add("badge-secondary");
    }

    // Lookup metadata
    const cleanNo = flight_no.replace(/\D/g, "").replace(/^0+/, "");
    const match = (window.flightsList || []).find(f => {
        const fNo = String(f.flt_no || f.Flt_No || "").replace(/\D/g, "").replace(/^0+/, "");
        return fNo === cleanNo;
    });

    const caterer = match ? (match.caterer_code || match.Caterer_Code || "OFS") : "OFS";
    const aircraft = match ? (match.aircraft_type || match.AircraftType || "A321") : "A321";

    const catererEl = document.getElementById("inspect-meta-caterer");
    const aircraftEl = document.getElementById("inspect-meta-aircraft");
    if (catererEl) catererEl.textContent = caterer;
    if (aircraftEl) aircraftEl.textContent = aircraft;

    // Set extra metadata if available
    const routeEl = document.getElementById("inspect-meta-route");
    const dateEl = document.getElementById("inspect-meta-date");
    const stdEl = document.getElementById("inspect-meta-std");
    const staEl = document.getElementById("inspect-meta-sta");

    if (state.flight_meta) {
        if (routeEl) routeEl.textContent = (state.flight_meta.dep && state.flight_meta.arr) ? `${state.flight_meta.dep} ➔ ${state.flight_meta.arr}` : "—";
        if (dateEl) dateEl.textContent = state.flight_meta.flight_date || "—";
        if (stdEl) stdEl.textContent = state.flight_meta.std || "—";
        if (staEl) staEl.textContent = state.flight_meta.sta || "—";
    } else {
        const csvRoute = match ? `${match.dep || match.Dep || 'DEL'} ➔ ${match.arr || match.Arr || '—'}` : "—";
        const csvDate = match ? (match.flight_date || match.FlightDate || getActiveFileDate() || "—") : "—";
        if (routeEl) routeEl.textContent = csvRoute;
        if (dateEl) dateEl.textContent = csvDate;
        if (stdEl) stdEl.textContent = "—";
        if (staEl) staEl.textContent = "—";
    }

    // Update Timeline Steps
    const matchStep = document.getElementById("timeline-step-match");
    const fetchStep = document.getElementById("timeline-step-fetch");
    const writeStep = document.getElementById("timeline-step-write");

    if (matchStep && fetchStep && writeStep) {
        matchStep.className = "timeline-step success"; // always matched if we are inspecting

        // Fetch step
        if (state.portal_devices) {
            fetchStep.className = "timeline-step success";
        } else if (state.status === "processing" || state.status === "sleeping") {
            fetchStep.className = "timeline-step active";
        } else if (state.status === "failed" && !state.portal_devices) {
            fetchStep.className = "timeline-step failed";
        } else {
            fetchStep.className = "timeline-step";
        }

        // Write step
        if (state.status === "success") {
            writeStep.className = "timeline-step success";
        } else if (state.status === "failed") {
            writeStep.className = "timeline-step failed";
        } else if (state.status === "processing" && state.portal_devices) {
            writeStep.className = "timeline-step active";
        } else {
            writeStep.className = "timeline-step";
        }
    }

    // Populate positions editor
    const editor = document.getElementById("inspector-positions-editor");
    if (!editor) return;

    editor.innerHTML = "";

    // Header row
    const headRow = document.createElement("div");
    headRow.className = "inspector-input-row";
    headRow.style.fontWeight = "bold";
    headRow.style.borderBottom = "1px solid rgba(255,255,255,0.15)";
    headRow.style.background = "rgba(0,0,0,0.2)";
    headRow.innerHTML = `
        <div>Pos</div>
        <div>Target</div>
        <div>Current</div>
        <div>Adjusted</div>
    `;
    editor.appendChild(headRow);

    // Determine relevant positions
    const posList = POSITION_COLS.filter(pos => {
        const hasPlan = state.positions && state.positions[pos] !== undefined && state.positions[pos] !== null;
        const hasPortal = state.portal_devices && state.portal_devices[pos] !== undefined;
        return hasPlan || hasPortal;
    });

    if (posList.length === 0) {
        editor.innerHTML += `<div class="text-muted text-center py-3" style="font-size:11px;">No device allocations configured or found on portal.</div>`;
    } else {
        posList.forEach(pos => {
            const plannedVal = state.positions[pos] || "";
            const portalValRaw = state.portal_devices ? (state.portal_devices[pos] || "") : "";
            const portalVal = portalValRaw.replace(/^RET/, "");

            // Prefill adjusted input value:
            // Use current final allocation if written, else prefill plannedVal, else portalVal
            let prefilled = "";
            if (state.final_allocations && state.final_allocations[pos] !== undefined) {
                prefilled = state.final_allocations[pos].replace(/^RET/, "");
            } else if (plannedVal) {
                prefilled = plannedVal;
            } else {
                prefilled = portalVal;
            }

            let t_ciid = "";
            if (state.devices_raw) {
                const dev = state.devices_raw.find(d => d.type === pos);
                if (dev) t_ciid = dev.t_ciid || "";
            }

            const rowDiv = document.createElement("div");
            rowDiv.className = "inspector-input-row";
            rowDiv.innerHTML = `
                <div class="inspector-input-lbl">${pos}</div>
                <div class="inspector-val-plan">${plannedVal ? 'RET' + plannedVal : '—'}</div>
                <div class="inspector-val-portal">${portalVal ? 'RET' + portalVal : '—'}</div>
                <div>
                    <input type="text" class="inspector-input-field" 
                           data-pos="${pos}" 
                           data-t-ciid="${t_ciid}" 
                           value="${prefilled}" 
                           maxlength="5"
                           onkeypress="return event.charCode >= 48 && event.charCode <= 57"
                           ${state.status === "skipped" || state.status === "success" ? "disabled" : ""}>
                </div>
            `;
            editor.appendChild(rowDiv);
        });
    }

    // Toggle Button Enabled States
    const isManualRun = bulkExecutionMode === "review" && bulkAutomationRunning && (bulkInspectFlightNo === bulkManualRows[bulkManualCurrentIndex]?.flight_no);
    const hasPortal = !!state.portal_devices;

    const btnSubmit = document.getElementById("btn-inspect-submit");
    const btnSkip = document.getElementById("btn-inspect-skip");
    const btnRefetch = document.getElementById("btn-inspect-refetch");

    if (btnSubmit) {
        btnSubmit.disabled = !isManualRun || !hasPortal || state.status === "success";
        btnSubmit.innerHTML = "Save &amp; Submit";
    }
    if (btnSkip) {
        btnSkip.disabled = !isManualRun || state.status === "success";
    }
    if (btnRefetch) {
        btnRefetch.disabled = !isManualRun;
    }

    // Show/Hide Error Card
    const errCard = document.getElementById("inspector-error-card");
    const errMsg = document.getElementById("inspect-error-msg");
    if (errCard && errMsg) {
        if (state.status === "failed" && state.status_message) {
            errCard.style.display = "block";
            errMsg.textContent = state.status_message;
        } else {
            errCard.style.display = "none";
        }
    }

    // Update Server Response Panel Tabs and Contents
    bulkUpdateServerResponsePanel(state);
}

function bulkSwitchServerTab(tab) {
    document.querySelectorAll(".srv-tab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.id === `srv-tab-${tab}`);
    });
    document.querySelectorAll(".srv-tab-content").forEach(content => {
        content.classList.toggle("active", content.id === `srv-content-${tab}`);
    });
    // Auto-expand panel when tab is clicked
    bulkToggleServerPanel(false);
}

function bulkToggleServerPanel(forceCollapse) {
    const panel = document.getElementById("server-response-panel");
    const btn = document.getElementById("srv-collapse-btn");
    const body = document.getElementById("srv-response-body");
    if (!panel || !btn || !body) return;

    let shouldCollapse;
    if (typeof forceCollapse === "boolean") {
        shouldCollapse = forceCollapse;
    } else {
        shouldCollapse = !panel.classList.contains("collapsed");
    }

    if (shouldCollapse) {
        panel.classList.add("collapsed");
        body.style.display = "none";
        btn.textContent = "▲";
    } else {
        panel.classList.remove("collapsed");
        body.style.display = "block";
        btn.textContent = "▼";
    }
}

function bulkUpdateServerResponsePanel(state) {
    // 1. Portal Fetch Content
    const portalDiv = document.getElementById("srv-content-portal");
    if (portalDiv) {
        if (state.devices_raw && state.devices_raw.length > 0) {
            let html = `
                <table class="srv-data-table">
                    <thead>
                        <tr>
                            <th>Position</th>
                            <th>T_CIID</th>
                            <th>Asset ID</th>
                            <th>Received Station</th>
                            <th>Cart Flag</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            state.devices_raw.forEach(d => {
                html += `
                    <tr>
                        <td style="font-weight: 700; color: var(--primary);">${d.type || "—"}</td>
                        <td>${d.t_ciid || "—"}</td>
                        <td>${d.asset_id || "—"}</td>
                        <td>${d.received_station || "—"}</td>
                        <td><span class="badge ${d.cart_flag === 1 ? 'badge-green' : 'badge-secondary'}" style="font-size: 8px; padding: 1px 3px;">${d.cart_flag ?? "—"}</span></td>
                    </tr>
                `;
            });
            html += `</tbody></table>`;

            // If carts exist, add them too
            if (state.carts_raw && state.carts_raw.length > 0) {
                html += `
                    <div style="margin-top: 10px; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 6px;">
                        <div style="font-size: 10px; font-weight: 700; color: var(--primary); margin-bottom: 4px;">Carts Details (Cops Layout)</div>
                        <table class="srv-data-table">
                            <thead>
                                <tr>
                                    <th>Cart ID</th>
                                    <th>Caterer</th>
                                    <th>Description</th>
                                    <th>Type</th>
                                </tr>
                            </thead>
                            <tbody>
                `;
                state.carts_raw.forEach(c => {
                    html += `
                        <tr>
                            <td>${c.cart_no || "—"}</td>
                            <td>${c.caterer_code || "—"}</td>
                            <td style="color: var(--text-muted);">${c.cart_desc || "—"}</td>
                            <td>${c.cart_type || "—"}</td>
                        </tr>
                    `;
                });
                html += `</tbody></table></div>`;
            }
            portalDiv.innerHTML = html;
        } else {
            if (state.status === "processing" || state.status === "sleeping" || state.status === "pending") {
                portalDiv.innerHTML = `<div class="text-muted" style="font-size: 11px; text-align: center; padding: 20px;"><span class="bulk-spinner" style="width:12px; height:12px; border-width:1.5px; vertical-align:middle; margin-right:6px;"></span>Querying Indigo Cops portal...</div>`;
            } else if (state.status === "skipped") {
                portalDiv.innerHTML = `<div class="text-muted" style="font-size: 11px; text-align: center; padding: 20px;">Flight skipped: ${state.skip_reason || "no explanation"}</div>`;
            } else {
                portalDiv.innerHTML = `<div class="text-muted" style="font-size: 11px; text-align: center; padding: 20px;">No portal data found or fetch failed.</div>`;
            }
        }
    }

    // 2. Write Response Content
    const writeDiv = document.getElementById("srv-content-write");
    if (writeDiv) {
        if (state.server_response) {
            const resp = state.server_response;
            const statusVal = resp.Status ?? resp.status ?? (state.status === "success" ? 1 : 0);
            const statusText = statusVal === 1 ? '<span class="badge badge-green">Status: Success (1)</span>' : '<span class="badge badge-red">Status: Failed (' + statusVal + ')</span>';
            const msg = resp.message || resp.error || state.status_message || "No message returned";

            let html = `
                <div style="margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                    ${statusText}
                    <span style="font-family: var(--font-code); font-size: 9px; color: var(--text-muted);">Code: ${resp.Code ?? "—"}</span>
                </div>
                <div class="srv-kv-row">
                    <span class="srv-kv-key">API Message</span>
                    <span class="srv-kv-val" style="color: #fff; font-family: inherit;">${msg}</span>
                </div>
            `;

            if (resp.CartNumbers) {
                html += `
                    <div class="srv-kv-row">
                        <span class="srv-kv-key">CartNumbers Rejected</span>
                        <span class="srv-kv-val" style="color: var(--danger);">${resp.CartNumbers}</span>
                    </div>
                `;
            }

            if (state.final_allocations) {
                html += `
                    <div style="margin-top: 8px;">
                        <span style="font-size: 9px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Submitted Positions Map:</span>
                        <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;">
                `;
                for (const [pos, val] of Object.entries(state.final_allocations)) {
                    const cleanVal = val.replace(/^RET/, "");
                    html += `
                        <div style="font-size: 9px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); padding: 2px 5px; border-radius: 3px; font-family: var(--font-code);">
                            <span style="color: var(--primary); font-weight:700; margin-right:4px;">${pos}:</span>
                            <span style="color: #fff;">${cleanVal ? 'RET' + cleanVal : 'CLEAR'}</span>
                        </div>
                    `;
                }
                html += `</div></div>`;
            }

            writeDiv.innerHTML = html;
        } else {
            if (state.status === "success") {
                writeDiv.innerHTML = `<div class="text-muted" style="font-size: 11px; text-align: center; padding: 20px;">✅ Write completed. Dry run mode was active.</div>`;
            } else if (state.status === "failed") {
                writeDiv.innerHTML = `<div class="text-muted" style="font-size: 11px; text-align: center; padding: 20px; color: var(--danger);">❌ Write failed: ${state.status_message || "Unknown error"}</div>`;
            } else if (state.status === "processing" && state.portal_devices) {
                writeDiv.innerHTML = `<div class="text-muted" style="font-size: 11px; text-align: center; padding: 20px;"><span class="bulk-spinner" style="width:12px; height:12px; border-width:1.5px; vertical-align:middle; margin-right:6px;"></span>Submitting updates to portal...</div>`;
            } else {
                writeDiv.innerHTML = `<div class="text-muted" style="font-size: 11px; text-align: center; padding: 20px;">No write action taken yet.</div>`;
            }
        }
    }

    // 3. Raw JSON Tab
    const rawPre = document.getElementById("srv-json-raw");
    if (rawPre) {
        const rawObj = {
            flight_no: state.flight_no,
            status: state.status,
            planned_positions: state.positions,
            portal_fetch: state.fetch_raw_response || null,
            write_response: state.server_response || null
        };
        rawPre.textContent = JSON.stringify(rawObj, null, 2);
    }
}


async function bulkRunManualReviewStep(idx) {
    bulkManualCurrentIndex = idx;

    // Update progress bar
    const progBar = document.getElementById("bulk-progress-bar");
    if (progBar && bulkManualRows.length > 0) {
        progBar.style.width = `${Math.min(100, Math.round((idx / bulkManualRows.length) * 100))}%`;
    }

    if (idx >= bulkManualRows.length) {
        bulkAutomationRunning = false;
        if (progBar) progBar.style.width = "100%";
        document.getElementById("btn-bulk-close2").style.display = "inline-flex";
        if (bulkFailedRows.length > 0) {
            document.getElementById("btn-bulk-retry").style.display = "inline-flex";
        }

        // Render final summary
        const summary = document.getElementById("bulk-summary");
        const total = bulkManualRows.filter(r => !r.skip_reason).length;
        const successes = Object.values(bulkFlightExecutionState).filter(s => s.status === "success").length;
        const skipped = Object.values(bulkFlightExecutionState).filter(s => s.status === "skipped").length;
        const errors = Object.values(bulkFlightExecutionState).filter(s => s.status === "failed" || s.status === "not_found").length;

        _bulkRenderSummary({
            total: total,
            success: successes,
            retry_cleared: 0,
            skipped: skipped,
            not_found: Object.values(bulkFlightExecutionState).filter(s => s.status === "not_found").length,
            error: errors,
            shift_label: document.getElementById("bulk-confirm-shift").value || null,
            dry_run: document.getElementById("input-dry-run").checked
        }, summary);

        _bulkAddFeed("warn", "User-Review execution complete.");
        return;
    }

    const row = bulkManualRows[idx];
    const flight_no = row.flight_no;
    const state = bulkFlightExecutionState[flight_no];

    if (state.skip_reason) {
        state.status = "skipped";
        bulkUpdateFlightRow(flight_no);
        _bulkAddFeed("skip", `Flight ${flight_no} skipped — ${state.skip_reason}`);
        setTimeout(() => bulkRunManualReviewStep(idx + 1), 100);
        return;
    }

    // Inspect this flight
    bulkInspectFlight(flight_no);

    state.status = "processing";
    bulkUpdateFlightRow(flight_no);
    _bulkAddFeed("start", `User-Reviewing Flight ${flight_no}...`);

    bulkUpdateSvgCabin(flight_no, "flight_start", {});
    bulkUpdateStatsCards();

    // Match in CSV
    const cleanNo = flight_no.replace(/\D/g, "").replace(/^0+/, "");
    const match = (window.flightsList || []).find(f => {
        const fNo = String(f.flt_no || f.Flt_No || "").replace(/\D/g, "").replace(/^0+/, "");
        return fNo === cleanNo;
    });

    if (!match) {
        state.status = "not_found";
        bulkUpdateFlightRow(flight_no);
        _bulkAddFeed("notfound", `Flight ${flight_no} not found in CSV.`);
        bulkUpdateSvgCabin(flight_no, "flight_error", {});
        bulkUpdateStatsCards();
        if (!bulkFailedRows.includes(row)) bulkFailedRows.push(row);

        setTimeout(() => bulkRunManualReviewStep(idx + 1), 1500);
        return;
    }

    const caterer = match.caterer_code || match.Caterer_Code || "";
    const aircraft_id = match.aircraft_type_id || match.AircraftTypeId || "";
    const station = document.getElementById("bulk-confirm-station").value || "DEL";
    const dateVal = getActiveFileDate();

    // Step 2: Fetch Portal allocations
    state.status = "processing";
    bulkUpdateFlightRow(flight_no);
    document.getElementById("timeline-step-fetch").className = "timeline-step active";

    try {
        const query = new URLSearchParams({
            station,
            date: dateVal,
            flight_number: flight_no,
            caterer_code: caterer,
            aircraft_type_id: aircraft_id
        });

        const response = await fetch(`/api/flights/cart-allocation?${query.toString()}`);
        if (!response.ok) {
            throw new Error("Failed to load portal allocations");
        }

        const data = await response.json();

        state.portal_devices = {};
        if (data.devices) {
            state.devices_raw = data.devices;
            data.devices.forEach(d => {
                state.portal_devices[d.type] = d.asset_id || "";
            });
        }
        state.carts_raw = data.carts || [];
        state.flight_meta = {
            flight_date: data.flight_date || "",
            caterer: data.caterer || "",
            dep: data.dep || "",
            arr: data.arr || "",
            std: data.std || "",
            sta: data.sta || ""
        };
        state.fetch_raw_response = data;

        state.status = "processing";
        bulkUpdateFlightRow(flight_no);
        bulkUpdateSvgCabin(flight_no, "portal_data", {});

        document.getElementById("timeline-step-fetch").className = "timeline-step success";
        document.getElementById("timeline-step-write").className = "timeline-step active";

        bulkInspectFlight(flight_no);

        document.getElementById("btn-inspect-refetch").disabled = false;
        document.getElementById("btn-inspect-skip").disabled = false;
        document.getElementById("btn-inspect-submit").disabled = false;

        const devList = (data.devices || []).map(d => `${d.type}: ${d.asset_id || "None"}`).join(", ");
        _bulkAddFeed("info", `Flight <span class="flt">${flight_no}</span> — Portal data fetched: [${devList}], Carts: ${(data.carts || []).length}. Awaiting user review...`);

    } catch (e) {
        state.status = "failed";
        state.status_message = e.message;
        bulkUpdateFlightRow(flight_no);
        _bulkAddFeed("error", `Flight ${flight_no} failed to fetch portal: ${e.message}`);

        document.getElementById("timeline-step-fetch").className = "timeline-step failed";
        bulkUpdateSvgCabin(flight_no, "flight_error", {});

        document.getElementById("btn-inspect-refetch").disabled = false;
        document.getElementById("btn-inspect-skip").disabled = false;
        document.getElementById("btn-inspect-submit").disabled = false;

        const errCard = document.getElementById("inspector-error-card");
        const errMsg = document.getElementById("inspect-error-msg");
        if (errCard && errMsg) {
            errCard.style.display = "block";
            errMsg.textContent = `Fetch Error: ${e.message}`;
        }

        if (!bulkFailedRows.includes(row)) bulkFailedRows.push(row);
    }
}

async function bulkInspectSubmit() {
    const flight_no = bulkInspectFlightNo;
    const state = bulkFlightExecutionState[flight_no];
    if (!state) return;

    const btnSubmit = document.getElementById("btn-inspect-submit");
    const btnSkip = document.getElementById("btn-inspect-skip");
    const btnRefetch = document.getElementById("btn-inspect-refetch");

    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<span class="bulk-spinner" style="width:10px; height:10px; border-width:1.5px;"></span> Submitting...`;

    const inputs = document.querySelectorAll(".inspector-input-field");
    const allocations = [];
    const positionsSent = {};

    inputs.forEach(input => {
        const pos = input.getAttribute("data-pos");
        const t_ciid = input.getAttribute("data-t-ciid");
        const rawVal = input.value.trim();
        const asset_number = rawVal ? `RET${rawVal}` : "";

        allocations.push({
            t_ciid: t_ciid,
            cart_type: pos,
            asset_number: asset_number
        });
        positionsSent[pos] = asset_number;
    });

    const cleanNo = flight_no.replace(/\D/g, "").replace(/^0+/, "");
    const match = (window.flightsList || []).find(f => {
        const fNo = String(f.flt_no || f.Flt_No || "").replace(/\D/g, "").replace(/^0+/, "");
        return fNo === cleanNo;
    });

    const aircraft_id = match ? (match.aircraft_type_id || match.AircraftTypeId) : "";
    const station = document.getElementById("bulk-confirm-station").value || "DEL";

    const payload = {
        flight_number: flight_no,
        station: station,
        aircraft_type_id: String(aircraft_id),
        allocations: allocations
    };

    const errCard = document.getElementById("inspector-error-card");
    if (errCard) errCard.style.display = "none";

    try {
        const response = await fetch("/api/flights/update-device-allocation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || "Write submission failed");
        }

        const result = await response.json();

        if (result.Status === 1) {
            state.status = "success";
            state.final_allocations = positionsSent;
            state.server_response = result;
            bulkUpdateFlightRow(flight_no);
            const sentList = Object.entries(positionsSent).map(([pos, val]) => `${pos}➔${val}`).join(", ");
            _bulkAddFeed("success", `Flight <span class="flt">${flight_no}</span> — Saved: [${sentList}]. API Response: "${result.message || 'Success'}"`);

            bulkUpdateSvgCabin(flight_no, "flight_success", {});
            bulkUpdateStatsCards();
            bulkUpdateHeatmapGraph();

            document.getElementById("timeline-step-write").className = "timeline-step success";

            setTimeout(() => {
                bulkRunManualReviewStep(bulkManualCurrentIndex + 1);
            }, 1000);

        } else {
            // Save the failed response
            state.server_response = result;
            throw new Error(result.message || "Portal rejected allocations.");
        }

    } catch (e) {
        state.status = "failed";
        state.status_message = e.message;
        if (!state.server_response) {
            state.server_response = { error: e.message, status: "failed" };
        }
        bulkUpdateFlightRow(flight_no);
        const errResp = state.server_response ? JSON.stringify(state.server_response) : "None";
        _bulkAddFeed("error", `Flight <span class="flt">${flight_no}</span> — Submission failed: ${e.message}. API Response: ${errResp}`);

        document.getElementById("timeline-step-write").className = "timeline-step failed";
        bulkUpdateSvgCabin(flight_no, "flight_error", {});
        bulkUpdateStatsCards();

        if (errCard) {
            errCard.style.display = "block";
            const errMsg = document.getElementById("inspect-error-msg");
            if (errMsg) errMsg.textContent = e.message;
        }

        btnSubmit.disabled = false;
        btnSubmit.innerHTML = "Save &amp; Submit";
        btnSkip.disabled = false;
        btnRefetch.disabled = false;

        const row = bulkManualRows[bulkManualCurrentIndex];
        if (row && !bulkFailedRows.includes(row)) {
            bulkFailedRows.push(row);
        }
    }
}

function bulkInspectSkip() {
    const flight_no = bulkInspectFlightNo;
    const state = bulkFlightExecutionState[flight_no];
    if (!state) return;

    state.status = "skipped";
    state.skip_reason = "User skipped during review";
    bulkUpdateFlightRow(flight_no);
    _bulkAddFeed("skip", `Flight ${flight_no} skipped by user.`);
    bulkUpdateStatsCards();

    const errCard = document.getElementById("inspector-error-card");
    if (errCard) errCard.style.display = "none";

    bulkRunManualReviewStep(bulkManualCurrentIndex + 1);
}

function bulkInspectRefetch() {
    bulkRunManualReviewStep(bulkManualCurrentIndex);
}

function bulkUpdateHeatmapGraph() {
    const counts = { L1: 0, L2: 0, L3: 0, L4: 0, R1: 0, R2: 0, R3: 0, R4: 0, STDBY1: 0, STDBY2: 0 };
    Object.values(bulkFlightExecutionState).forEach(state => {
        if (state.status === "success" && state.final_allocations) {
            Object.keys(state.final_allocations).forEach(pos => {
                if (state.final_allocations[pos] && counts[pos] !== undefined) {
                    counts[pos]++;
                }
            });
        }
    });

    const max = Math.max(1, ...Object.values(counts));
    const container = document.getElementById("allocation-bar-graph");
    if (!container) return;

    container.innerHTML = "";
    const positions = ["L1", "L2", "L3", "L4", "R1", "R2", "R3", "R4", "STDBY1", "STDBY2"];
    positions.forEach(pos => {
        const count = counts[pos];
        const pct = (count / max) * 45; // max height 45px
        const bar = document.createElement("div");
        bar.className = "allocation-graph-bar";
        bar.style.height = `${Math.max(2, pct)}px`;
        bar.setAttribute("data-count", count);
        bar.title = `${pos}: ${count} allocation(s)`;
        container.appendChild(bar);
    });
}

function bulkExportReportCSV(statusFilter) {
    const headers = ["Flight No", "L1", "L2", "L3", "L4", "R1", "R2", "R3", "R4", "STDBY1", "STDBY2", "Status", "Message"];
    const rows = [headers.join(",")];

    Object.keys(bulkFlightExecutionState).forEach(flight_no => {
        const s = bulkFlightExecutionState[flight_no];
        const match = (statusFilter === "success")
            ? (s.status === "success")
            : (s.status === "failed" || s.status === "not_found");

        if (match) {
            const rowData = [
                flight_no,
                s.positions.L1 || "",
                s.positions.L2 || "",
                s.positions.L3 || "",
                s.positions.L4 || "",
                s.positions.R1 || "",
                s.positions.R2 || "",
                s.positions.R3 || "",
                s.positions.R4 || "",
                s.positions.STDBY1 || "",
                s.positions.STDBY2 || "",
                s.status,
                s.status_message ? `"${s.status_message.replace(/"/g, '""')}"` : ""
            ];
            rows.push(rowData.join(","));
        }
    });

    if (rows.length <= 1) {
        showToast(`No flights found with status: ${statusFilter}`, true);
        return;
    }

    const csvText = rows.join("\n");
    navigator.clipboard.writeText(csvText).then(() => {
        showToast(`Copied ${rows.length - 1} ${statusFilter} flight row(s) to clipboard as CSV!`);
    }).catch(err => {
        showToast("Failed to copy CSV: " + err, true);
    });
}

function bulkExportFullLogs() {
    if (bulkLogLines.length === 0) {
        showToast("No logs available to copy.", true);
        return;
    }

    const logText = bulkLogLines.join("\n");
    navigator.clipboard.writeText(logText).then(() => {
        showToast("Copied all live logs to clipboard!");
    }).catch(err => {
        showToast("Failed to copy logs: " + err, true);
    });
}

function bulkCopyInspectError() {
    const errMsg = document.getElementById("inspect-error-msg");
    if (errMsg && errMsg.textContent) {
        navigator.clipboard.writeText(errMsg.textContent).then(() => {
            showToast("Copied error to clipboard!");
        }).catch(err => {
            showToast("Failed to copy error: " + err, true);
        });
    }
}

// ── SVG Cabin Door LEDs ────────────────────────────
// Updates the fuselage SVG door status LEDs based on flight events.
function bulkUpdateSvgCabin(flight_no, eventType, data) {
    const telemetryText = document.getElementById("svg-telemetry-text");

    // Update telemetry overlay text
    if (telemetryText) {
        if (eventType === "flight_start") {
            telemetryText.textContent = `FLT ${flight_no} ACTIVE`;
            telemetryText.style.fill = "#4f72f5";
        } else if (eventType === "portal_data") {
            telemetryText.textContent = `FLT ${flight_no} PORTAL OK`;
            telemetryText.style.fill = "#00d68f";
        } else if (eventType === "flight_success") {
            telemetryText.textContent = `FLT ${flight_no} ✓ SAVED`;
            telemetryText.style.fill = "#00d68f";
        } else if (eventType === "flight_retry_success") {
            telemetryText.textContent = `FLT ${flight_no} ⚠ PARTIAL`;
            telemetryText.style.fill = "#ffa726";
        } else if (eventType === "flight_error" || eventType === "flight_retry_failed") {
            telemetryText.textContent = `FLT ${flight_no} ✗ ERROR`;
            telemetryText.style.fill = "#ff5252";
        } else if (eventType === "sleep_tick") {
            telemetryText.textContent = `SLEEPING ${data.duration || 0}s`;
            telemetryText.style.fill = "#b388ff";
        }
    }

    // Light up relevant door LEDs based on planned positions
    const state = bulkFlightExecutionState[flight_no];
    if (!state) return;

    const positions = state.positions || {};
    const ledClass = {
        "flight_start": "led-active",
        "portal_data": "led-active",
        "flight_success": "led-success",
        "flight_retry_success": "led-success",
        "flight_error": "led-error",
        "flight_retry_failed": "led-error",
        "sleep_tick": "led-sleep"
    }[eventType] || "led-active";

    POSITION_COLS.forEach(pos => {
        const led = document.querySelector(`#svg-door-${pos} .door-status-led`);
        if (!led) return;

        const isCleared = state.final_allocations && state.final_allocations[pos] === "" && positions[pos] && positions[pos] !== "";

        if (isCleared) {
            led.className = "door-status-led led-error";
        } else if (positions[pos] && positions[pos] !== "") {
            led.className = `door-status-led ${ledClass}`;
        } else if (eventType === "flight_start") {
            led.className = "door-status-led led-inactive";
        }
    });
}

// ── Stats Cards Update ─────────────────────────────
// Updates the 4 telemetry stats cards: Progress, Success Rate, Sleep, Errors.
function bulkUpdateStatsCards() {
    const states = Object.values(bulkFlightExecutionState);
    const total = states.length;
    const completed = states.filter(s => ["success", "failed", "not_found", "skipped"].includes(s.status)).length;
    const successes = states.filter(s => s.status === "success").length;
    const errors = states.filter(s => s.status === "failed" || s.status === "not_found").length;
    const processed = states.filter(s => ["success", "failed", "not_found"].includes(s.status)).length;
    const sleeping = states.find(s => s.status === "sleeping");

    // Progress card
    const progVal = document.getElementById("stat-progress-val");
    const progPct = document.getElementById("stat-progress-pct");
    if (progVal) progVal.textContent = `${completed} / ${total}`;
    if (progPct) progPct.textContent = total > 0 ? `${Math.round((completed / total) * 100)}%` : "0%";

    // Success card
    const succVal = document.getElementById("stat-success-val");
    const succPct = document.getElementById("stat-success-pct");
    if (succVal) succVal.textContent = successes;
    if (succPct) {
        const rate = processed > 0 ? Math.round((successes / processed) * 100) : 100;
        succPct.textContent = `${rate}% Rate`;
    }

    // Sleep card
    const sleepVal = document.getElementById("stat-sleep-val");
    const sleepLbl = document.getElementById("stat-sleep-lbl");
    if (sleeping) {
        if (sleepVal) sleepVal.textContent = `${sleeping.countdown}s`;
        if (sleepLbl) sleepLbl.textContent = `FLT ${sleeping.flight_no}`;
    } else {
        if (sleepVal) sleepVal.textContent = "0.0s";
        if (sleepLbl) sleepLbl.textContent = completed >= total && total > 0 ? "Done" : "Ready";
    }

    // Errors card
    const errVal = document.getElementById("stat-errors-val");
    const errLbl = document.getElementById("stat-errors-lbl");
    if (errVal) errVal.textContent = errors;
    if (errLbl) errLbl.textContent = `${errors} Error${errors !== 1 ? "s" : ""}`;
}
