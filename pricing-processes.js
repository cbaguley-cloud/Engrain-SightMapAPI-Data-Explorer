let pricingRawResults = [];
let pricingFilteredResults = [];
let pricingAbortController = null;

document.addEventListener("DOMContentLoaded", () => {
  // Buttons
  const acctBtn = document.getElementById("runPricingAccountBtn");
  if (acctBtn) acctBtn.addEventListener("click", runPricingAccountSearch);

  const singleBtn = document.getElementById("runPricingSingleBtn");
  if (singleBtn) singleBtn.addEventListener("click", runPricingSingleSearch);

  const bulkBtn = document.getElementById("runPricingBulkBtn");
  if (bulkBtn) bulkBtn.addEventListener("click", runPricingBulkSearch);

  // Utils
  const dlBtn = document.getElementById("downloadPricingBtn");
  if (dlBtn) dlBtn.addEventListener("click", downloadPricingCSV);

  const cpBtn = document.getElementById("copyPricingClipBtn");
  if (cpBtn) cpBtn.addEventListener("click", copyPricingTable);

  // LOCAL STOP BUTTON
  const stopBtn = document.getElementById("stopPricingBtn");
  if (stopBtn) {
    stopBtn.addEventListener("click", () => {
      if (pricingAbortController) pricingAbortController.abort();
      stopBtn.style.display = "none";
    });
  }

  // GLOBAL KILL SWITCH LISTENER
  window.addEventListener("killAllProcesses", () => {
    if (pricingAbortController) {
      pricingAbortController.abort();
      const localStopBtn = document.getElementById("stopPricingBtn");
      if (localStopBtn) localStopBtn.style.display = "none";
      updatePricingStatus("🛑 Process globally terminated.");
    }
  });

  // Filters
  const filters = [
    "pricingFilterTag",
    "pricingFilterStrategy",
    "pricingFilterType",
    "pricingFilterProcedure",
  ];
  filters.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", applyPricingFilters);
  });

  // Template
  const tmplLink = document.getElementById("pricingTemplateLink");
  if (tmplLink) {
    tmplLink.addEventListener("click", (e) => {
      e.preventDefault();
      const csvContent = "asset_id\n1323\n1324";
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "pricing_template.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }
});

function getPricingApiKey() {
  const key = document.getElementById("apiKey").value.trim();
  if (!key) alert("Please enter your API Key.");
  return key;
}

// ==========================================
// SEARCH MODES
// ==========================================

async function runPricingSingleSearch() {
  const apiKey = getPricingApiKey();
  if (!apiKey) return;
  const assetId = document.getElementById("pricingSingleId").value.trim();
  if (!assetId) {
    alert("Enter an Asset ID.");
    return;
  }

  await executePricingSearch(apiKey, [assetId]);
}

async function runPricingBulkSearch() {
  const apiKey = getPricingApiKey();
  if (!apiKey) return;
  const fileInput = document.getElementById("pricingCsvFile");
  if (fileInput.files.length === 0) {
    alert("Select a CSV file.");
    return;
  }

  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = async function (e) {
    const lines = e.target.result.split(/\r?\n/).filter(Boolean);
    const header = lines[0].toLowerCase();
    let assetIdx = 0;

    if (header.includes("asset")) {
      const parts = header.split(",");
      assetIdx = parts.findIndex((p) => p.includes("asset"));
      lines.shift();
    }

    const assetIds = lines
      .map((line) => {
        const parts = line.split(",");
        return parts[assetIdx]
          ? parts[assetIdx].trim().replace(/^"|"$/g, "")
          : null;
      })
      .filter(Boolean);

    if (assetIds.length === 0) {
      alert("No valid Asset IDs found.");
      return;
    }

    await executePricingSearch(apiKey, assetIds);
  };
  reader.readAsText(file);
}

async function runPricingAccountSearch() {
  const apiKey = getPricingApiKey();
  if (!apiKey) return;
  const accountId = document.getElementById("pricingAccountId").value.trim();
  if (!accountId) {
    alert("Enter an Account ID.");
    return;
  }

  if (pricingAbortController) pricingAbortController.abort();
  pricingAbortController = new AbortController();

  resetPricingUI();
  // SHOW button when Account search starts
  const stopBtn = document.getElementById("stopPricingBtn");
  if (stopBtn) stopBtn.style.display = "inline-block";
  updatePricingStatus("Step 1/2: Fetching all assets for Account...");

  try {
    let allAssets = [];
    let nextUrl = `https://api.sightmap.com/v1/accounts/${accountId}/assets?per-page=250`;

    while (nextUrl) {
      if (pricingAbortController.signal.aborted)
        throw new DOMException("Aborted", "AbortError");

      const res = await fetch(nextUrl, {
        headers: { "API-Key": apiKey, "Experimental-Flags": "accounts-assets" },
        signal: pricingAbortController.signal,
      });
      if (!res.ok) throw new Error(`Account fetch failed: ${res.status}`);
      const json = await res.json();
      allAssets = allAssets.concat(json.data || []);
      nextUrl = json.paging ? json.paging.next_url : null;
      updatePricingStatus(`Fetched ${allAssets.length} assets...`);
    }

    if (allAssets.length === 0) {
      updatePricingStatus("No assets found for this account.");
      if (stopBtn) stopBtn.style.display = "none";
      return;
    }

    const assetIds = allAssets.map((a) => a.id);
    updatePricingStatus(
      `Step 2/2: Found ${assetIds.length} assets. Fetching pricing data...`,
    );

    // Pass the IDs to the core engine
    await executePricingSearch(apiKey, assetIds, true);
  } catch (error) {
    if (stopBtn) stopBtn.style.display = "none";
    if (error.name !== "AbortError") {
      console.error(error);
      updatePricingStatus(`Error: ${error.message}`);
    } else {
      updatePricingStatus("🛑 Process Stopped.");
    }
  }
}

// ==========================================
// CORE EXECUTION ENGINE
// ==========================================

async function executePricingSearch(apiKey, assetIds, isContinuing = false) {
  if (!isContinuing) {
    if (pricingAbortController) pricingAbortController.abort();
    pricingAbortController = new AbortController();
    resetPricingUI();
  }

  // SHOW button when Core search starts
  const stopBtn = document.getElementById("stopPricingBtn");
  if (stopBtn) stopBtn.style.display = "inline-block";

  pricingRawResults = [];
  let completed = 0;
  const total = assetIds.length;
  const BATCH_SIZE = 10; // Prevent API rate limits/freezing

  updatePricingStatus(`Fetching pricing for ${total} assets...`);

  try {
    for (let i = 0; i < total; i += BATCH_SIZE) {
      if (pricingAbortController.signal.aborted)
        throw new DOMException("Aborted", "AbortError");

      const batch = assetIds.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (id) => {
        try {
          const url = `https://api.sightmap.com/v1/assets/${id}/multifamily/pricing?per-page=100`;
          const res = await fetch(url, {
            headers: { "API-Key": apiKey },
            signal: pricingAbortController.signal,
          });

          if (res.ok) {
            const json = await res.json();
            const data = json.data || [];
            data.forEach((item) => {
              pricingRawResults.push({
                assetId: id,
                processId: item.id,
                name: item.name || "-",
                strategy: item.pricing_strategy || "-",
                type: item.type || "-",
                procedure: item.procedure || "-",
                tags: Array.isArray(item.tags)
                  ? item.tags.join(", ")
                  : item.tags || "-",
              });
            });
          }
        } catch (err) {
          console.warn(`Pricing fetch failed for asset ${id}`);
        }
      });

      await Promise.all(promises);
      completed += batch.length;
      const percent = Math.floor((completed / total) * 100);
      updatePricingProgressBar(percent);
      updatePricingStatus(`Processed ${completed} / ${total} assets...`);
    }

    pricingFilteredResults = [...pricingRawResults];
    populatePricingFilters();
    renderPricingResults();

    updatePricingStatus(
      `Complete. Found ${pricingRawResults.length} pricing processes.`,
    );
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error(error);
      updatePricingStatus(`Error: ${error.message}`);
    } else {
      updatePricingStatus("🛑 Process Stopped.");
    }
  } finally {
    // HIDE button on finish or error
    if (stopBtn) stopBtn.style.display = "none";
  }
}

// ==========================================
// FILTERS & RENDERING
// ==========================================

function populatePricingFilters() {
  const tags = new Set();
  const strategies = new Set();
  const types = new Set();
  const procedures = new Set();

  pricingRawResults.forEach((r) => {
    if (r.tags && r.tags !== "-")
      r.tags.split(",").forEach((t) => tags.add(t.trim()));
    if (r.strategy !== "-") strategies.add(r.strategy);
    if (r.type !== "-") types.add(r.type);
    if (r.procedure !== "-") procedures.add(r.procedure);
  });

  fillSelect("pricingFilterTag", tags, "All Tags");
  fillSelect("pricingFilterStrategy", strategies, "All Strategies");
  fillSelect("pricingFilterType", types, "All Types");
  fillSelect("pricingFilterProcedure", procedures, "All Procedures");
}

function fillSelect(id, set, defaultText) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<option value="ALL">${defaultText}</option>`;
  Array.from(set)
    .sort()
    .forEach((val) => {
      el.insertAdjacentHTML(
        "beforeend",
        `<option value="${val}">${val}</option>`,
      );
    });
  el.disabled = set.size === 0;
}

function applyPricingFilters() {
  const tag = document.getElementById("pricingFilterTag").value;
  const strategy = document.getElementById("pricingFilterStrategy").value;
  const type = document.getElementById("pricingFilterType").value;
  const procedure = document.getElementById("pricingFilterProcedure").value;

  pricingFilteredResults = pricingRawResults.filter((r) => {
    if (tag !== "ALL" && !r.tags.includes(tag)) return false;
    if (strategy !== "ALL" && r.strategy !== strategy) return false;
    if (type !== "ALL" && r.type !== type) return false;
    if (procedure !== "ALL" && r.procedure !== procedure) return false;
    return true;
  });

  renderPricingResults();
}

function renderPricingResults() {
  const tbody = document.querySelector("#pricingTable tbody");
  tbody.innerHTML = "";
  document.getElementById("pricingCount").textContent =
    pricingFilteredResults.length;

  pricingFilteredResults.forEach((r) => {
    const row = `
            <tr>
                <td style="font-family:monospace; color:var(--accent-light); font-weight:bold;">${r.assetId}</td>
                <td style="font-family:monospace; color:#ccc;">${r.processId}</td>
                <td>${r.name}</td>
                <td>${r.tags ? `<span class="match-tag" style="background:var(--col-slate)">${r.tags}</span>` : "-"}</td>
                <td>${r.strategy}</td>
                <td>${r.type}</td>
                <td>${r.procedure}</td>
            </tr>
        `;
    tbody.insertAdjacentHTML("beforeend", row);
  });
}

// ==========================================
// UTILS
// ==========================================

function resetPricingUI() {
  pricingRawResults = [];
  pricingFilteredResults = [];
  document.querySelector("#pricingTable tbody").innerHTML = "";
  updatePricingProgressBar(0);
  document.getElementById("pricingCount").textContent = "0";

  [
    "pricingFilterTag",
    "pricingFilterStrategy",
    "pricingFilterType",
    "pricingFilterProcedure",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = `<option value="ALL">Loading...</option>`;
      el.disabled = true;
    }
  });
}

function updatePricingStatus(msg) {
  const el = document.getElementById("pricingStatusMsg");
  if (el) el.textContent = msg;
}

function updatePricingProgressBar(percent) {
  const bar = document.getElementById("pricingProgressBar");
  if (bar) {
    bar.style.width = `${percent}%`;
    bar.textContent = `${percent}%`;
  }
}

function downloadPricingCSV() {
  if (pricingFilteredResults.length === 0) {
    alert("No data");
    return;
  }
  let csv =
    "Asset ID,Process ID,Process Name,Tags,Pricing Strategy,Type,Procedure\n";
  pricingFilteredResults.forEach((r) => {
    const safe = (str) => `"${(str || "").replace(/"/g, '""')}"`;
    csv += `${r.assetId},${r.processId},${safe(r.name)},${safe(r.tags)},${safe(r.strategy)},${safe(r.type)},${safe(r.procedure)}\n`;
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "pricing_processes.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function copyPricingTable() {
  if (pricingFilteredResults.length === 0) {
    alert("No data");
    return;
  }
  let text =
    "Asset ID\tProcess ID\tProcess Name\tTags\tStrategy\tType\tProcedure\n";
  pricingFilteredResults.forEach((r) => {
    text += `${r.assetId}\t${r.processId}\t${r.name}\t${r.tags}\t${r.strategy}\t${r.type}\t${r.procedure}\n`;
  });
  navigator.clipboard.writeText(text);
  alert("Copied to clipboard!");
}
