/* account-auditor.js */

let auditResults = [];
let currentAccountAssets = [];
let auditAbortController = null;
let unmatchedAssets = [];
let unmatchedInputs = [];

document.addEventListener("DOMContentLoaded", () => {
  console.log("Initializing Account Auditor...");

  // --- Main Buttons ---
  const runBtn = document.getElementById("runAuditBtn");
  if (runBtn) runBtn.addEventListener("click", runAccountAudit);

  const dlBtn = document.getElementById("downloadAuditCsvBtn");
  if (dlBtn) dlBtn.addEventListener("click", downloadAuditCSV);

  const copyBtn = document.getElementById("copyAuditClipBtn");
  if (copyBtn) copyBtn.addEventListener("click", copyAuditTable);

  // --- Template Link ---
  const tmplLink = document.getElementById("auditTemplateLink");
  if (tmplLink) {
    const newLink = tmplLink.cloneNode(true);
    tmplLink.parentNode.replaceChild(newLink, tmplLink);
    newLink.addEventListener("click", (e) => {
      e.preventDefault();
      const csvContent =
        "asset_id,ref_id,name,address,city,state\n,100500,The Lofts,123 Main St,Denver,CO";
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "audit_template.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }

  // --- Unmatched Modals ---
  setupModal(
    "showUnmatchedBtn",
    "unmatchedModal",
    "closeUnmatchedModal",
    calculateAndShowUnmatched,
    "copyUnmatchedBtn",
    "downloadUnmatchedBtn",
    copyUnmatchedTable,
    downloadUnmatchedCSV,
  );
  setupModal(
    "showUnmatchedInputBtn",
    "unmatchedInputModal",
    "closeUnmatchedInputModal",
    calculateAndShowUnmatchedInputs,
    "copyUnmatchedInputBtn",
    "downloadUnmatchedInputBtn",
    copyUnmatchedInputTable,
    downloadUnmatchedInputCSV,
  );

  // Global Close
  window.addEventListener("click", (e) => {
    const m1 = document.getElementById("unmatchedModal");
    const m2 = document.getElementById("unmatchedInputModal");
    if (m1 && e.target === m1) m1.style.display = "none";
    if (m2 && e.target === m2) m2.style.display = "none";
  });
});

function setupModal(
  btnId,
  modalId,
  closeId,
  openFn,
  copyId,
  dlId,
  copyFn,
  dlFn,
) {
  const btn = document.getElementById(btnId);
  const modal = document.getElementById(modalId);
  const close = document.getElementById(closeId);
  const copy = document.getElementById(copyId);
  const dl = document.getElementById(dlId);

  if (btn)
    btn.addEventListener("click", () => {
      openFn();
      modal.style.display = "block";
    });
  if (close)
    close.addEventListener("click", () => (modal.style.display = "none"));
  if (copy) copy.addEventListener("click", copyFn);
  if (dl) dl.addEventListener("click", dlFn);
}

// ==========================================
// MAIN RUN FUNCTION
// ==========================================
async function runAccountAudit() {
  const apiKey = document.getElementById("apiKey").value.trim();
  const accountId = document.getElementById("auditAccountId").value.trim();
  const fileInput = document.getElementById("auditCsvFile");
  const forceSkipRefs = document.getElementById("auditSkipRefs").checked;
  const umBtn1 = document.getElementById("showUnmatchedBtn");
  const umBtn2 = document.getElementById("showUnmatchedInputBtn");

  if (!apiKey || !accountId) {
    alert("API Key and Account ID are required.");
    return;
  }
  if (fileInput.files.length === 0) {
    alert("Please select a CSV file.");
    return;
  }

  if (umBtn1) umBtn1.style.display = "none";
  if (umBtn2) umBtn2.style.display = "none";

  if (auditAbortController) auditAbortController.abort();
  auditAbortController = new AbortController();

  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = async function (e) {
    try {
      const csvData = parseAuditCSV(e.target.result);
      if (csvData.length === 0) {
        alert("No valid rows found in CSV.");
        return;
      }

      resetAuditUI();
      updateAuditStatus("Step 1: Fetching Account Assets...");
      document.getElementById("auditProgressBar").style.width = "10%";

      const assets = await fetchAssetsForAudit(
        apiKey,
        accountId,
        auditAbortController.signal,
      );
      currentAccountAssets = assets;

      if (assets.length === 0) {
        updateAuditStatus("No assets found in this account.");
        return;
      }

      const csvHasRefs = csvData.some((r) => r.ref_id);
      let refMap = new Map();

      if (csvHasRefs && !forceSkipRefs) {
        updateAuditStatus(
          `Step 2: Deep Scanning references for ${assets.length} assets...`,
        );
        refMap = await buildAuditReferenceMap(
          apiKey,
          assets,
          auditAbortController.signal,
        );
      } else {
        updateAuditStatus("Skipping reference fetch (Optimization).");
        document.getElementById("auditProgressBar").style.width = "60%";
      }

      // --- MATCHING ---
      updateAuditStatus("Step 3: Auditing data (Pass 1 - Strict)...");
      await new Promise((r) => setTimeout(r, 50));
      auditResults = performAuditMatching(csvData, assets, refMap);

      updateAuditStatus(
        "Step 4: Running Double Check (Pass 2 - Gap Analysis)...",
      );
      await new Promise((r) => setTimeout(r, 50));
      const recoveredCount = refineAuditResults(auditResults, assets);

      renderAuditResults(auditResults);

      const matchCount = auditResults.filter(
        (r) => r.status === "MATCHED" || r.status === "UNCERTAIN",
      ).length;
      let statusMsg = `✅ Audit Complete. Matched ${matchCount} / ${auditResults.length} rows.`;
      if (recoveredCount > 0)
        statusMsg += ` (Recovered ${recoveredCount} in pass 2)`;

      updateAuditStatus(statusMsg);
      document.getElementById("auditProgressBar").style.width = "100%";

      if (umBtn1) umBtn1.style.display = "inline-block";
      if (umBtn2) umBtn2.style.display = "inline-block";
    } catch (err) {
      if (err.name === "AbortError") {
        updateAuditStatus("Audit Cancelled.");
      } else {
        console.error(err);
        updateAuditStatus(`❌ Error: ${err.message}`);
      }
    }
  };
  reader.readAsText(file);
}

// ==========================================
// MATCHING LOGIC (ENHANCED)
// ==========================================

function performAuditMatching(inputRows, assets, refMap) {
  const assetIdMap = new Map();
  assets.forEach((a) => assetIdMap.set(String(a.id), a));

  return inputRows.map((row) => {
    let match = null;
    let method = "-";
    let score = 0;

    // 1. Asset ID
    if (row.asset_id && assetIdMap.has(String(row.asset_id))) {
      match = assetIdMap.get(String(row.asset_id));
      method = "Asset ID (Exact)";
      score = 1.0;
    }
    // 2. Reference ID
    else if (
      row.ref_id &&
      refMap.has(String(row.ref_id).trim().toLowerCase())
    ) {
      match = refMap.get(String(row.ref_id).trim().toLowerCase());
      method = "Reference ID (Exact)";
      score = 1.0;
    }
    // 3. Fuzzy (Pass 1 - Strict State Filter)
    else {
      let candidates = assets;

      // Smart State Filter: Normalize "Florida" -> "FL"
      if (row.state) {
        const rowStateCode = normalizeState(row.state);
        const stateFiltered = assets.filter((a) => {
          if (!a.address_state) return false;
          return normalizeState(a.address_state) === rowStateCode;
        });
        if (stateFiltered.length > 0) candidates = stateFiltered;
      }

      let bestScore = 0;
      let bestAsset = null;
      candidates.forEach((asset) => {
        const fuzzyScore = calculateAuditFuzzyScore(row, asset);
        if (fuzzyScore > bestScore) {
          bestScore = fuzzyScore;
          bestAsset = asset;
        }
      });

      if (bestScore > 0.82) {
        // Higher threshold for Pass 1
        match = bestAsset;
        method = `Fuzzy (${(bestScore * 100).toFixed(0)}%)`;
        score = bestScore;
      }
    }

    let status = "MISSING";
    if (match) status = "MATCHED";
    return { status, method, score, input: row, match: match };
  });
}

function refineAuditResults(results, allAssets) {
  const usedAssetIds = new Set();
  results.forEach((r) => {
    if (r.match) usedAssetIds.add(String(r.match.id));
  });

  const unusedAssets = allAssets.filter((a) => !usedAssetIds.has(String(a.id)));
  let recoveredCount = 0;

  results.forEach((r) => {
    if (r.status === "MISSING") {
      let bestScore = 0;
      let bestAsset = null;

      unusedAssets.forEach((asset) => {
        const score = calculateAuditFuzzyScore(r.input, asset);
        if (score > bestScore) {
          bestScore = score;
          bestAsset = asset;
        }
      });

      // Lower thresholds for Pass 2 because we are comparing leftovers
      if (bestScore > 0.7) {
        r.match = bestAsset;
        r.method = `Gap Analysis (${(bestScore * 100).toFixed(0)}%)`;
        r.score = bestScore;
        r.status = "MATCHED";

        // Remove from pool
        const idx = unusedAssets.findIndex((a) => a.id === bestAsset.id);
        if (idx > -1) unusedAssets.splice(idx, 1);
        recoveredCount++;
      } else if (bestScore > 0.55) {
        r.match = bestAsset;
        r.method = `Potential (${(bestScore * 100).toFixed(0)}%)`;
        r.score = bestScore;
        r.status = "UNCERTAIN";

        const idx = unusedAssets.findIndex((a) => a.id === bestAsset.id);
        if (idx > -1) unusedAssets.splice(idx, 1);
        recoveredCount++;
      }
    }
  });
  return recoveredCount;
}

// --- CORE SCORING LOGIC ---
function calculateAuditFuzzyScore(row, asset) {
  // Normalize everything aggressively
  const rowAddr = normalizeAddress(row.address);
  const rowName = normalizeString(row.name);
  const rowCity = normalizeString(row.city);

  const assetAddr = normalizeAddress(asset.address_line1);
  const assetName = normalizeString(asset.name);
  const assetCity = normalizeString(asset.address_city);

  // Address Score (Higher Weight)
  let addrScore = 0;
  if (rowAddr && assetAddr) {
    if (rowAddr === assetAddr) addrScore = 1.0;
    else if (rowAddr.includes(assetAddr) || assetAddr.includes(rowAddr))
      addrScore = 0.95;
    else {
      const sim = auditSimilarity(rowAddr, assetAddr);
      // Boost score if they share street number
      const rowNum = rowAddr.match(/^\d+/);
      const assetNum = assetAddr.match(/^\d+/);
      if (rowNum && assetNum && rowNum[0] === assetNum[0]) {
        addrScore = Math.max(sim, 0.7); // Minimum 0.7 if numbers match
      } else {
        addrScore = sim;
      }
    }
  }

  // Name Score
  let nameScore = 0;
  if (rowName && assetName) {
    if (rowName === assetName) nameScore = 1.0;
    else if (rowName.includes(assetName) || assetName.includes(rowName))
      nameScore = 0.9;
    else {
      // Use token matching for names (better for "The Olivia" vs "Olivia")
      const tokenScore = tokenMatch(rowName, assetName);
      const simScore = auditSimilarity(rowName, assetName);
      nameScore = Math.max(tokenScore, simScore);
    }
  }

  // City Penalty (Softened)
  let cityPenalty = 1.0;
  if (rowCity && assetCity) {
    if (rowCity !== assetCity) {
      // Check for "Fort Lauderdale" inside "North Fort Lauderdale"
      if (rowCity.includes(assetCity) || assetCity.includes(rowCity)) {
        cityPenalty = 0.9; // Small penalty
      } else {
        cityPenalty = 0.5; // Heavy penalty but not zero
      }
    }
  }

  // Final Weighting: Address is King, Name is Queen
  let total = 0;
  if (rowAddr) {
    total = addrScore * 0.65 + nameScore * 0.35;
  } else {
    total = nameScore;
  }

  return total * cityPenalty;
}

// ==========================================
// HELPERS (NORMALIZATION)
// ==========================================

function normalizeString(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[.,'’"#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAddress(str) {
  if (!str) return "";
  let s = str
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[.,'’"#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Standardize Directions
  s = s
    .replace(/\bnorth\b/g, "n")
    .replace(/\bsouth\b/g, "s")
    .replace(/\beast\b/g, "e")
    .replace(/\bwest\b/g, "w");
  // Standardize Types
  s = s
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\broad\b/g, "rd")
    .replace(/\bboulevard\b/g, "blvd")
    .replace(/\bparkway\b/g, "pkwy")
    .replace(/\blane\b/g, "ln")
    .replace(/\bdrive\b/g, "drv")
    .replace(/\bcourt\b/g, "ct")
    .replace(/\bhighway\b/g, "hwy");
  // Standardize Ordinals
  s = s
    .replace(/(\d+)th\b/g, "$1")
    .replace(/(\d+)st\b/g, "$1")
    .replace(/(\d+)nd\b/g, "$1")
    .replace(/(\d+)rd\b/g, "$1");

  return s;
}

const STATE_MAP = {
  alabama: "al",
  alaska: "ak",
  arizona: "az",
  arkansas: "ar",
  california: "ca",
  colorado: "co",
  connecticut: "ct",
  delaware: "de",
  florida: "fl",
  georgia: "ga",
  hawaii: "hi",
  idaho: "id",
  illinois: "il",
  indiana: "in",
  iowa: "ia",
  kansas: "ks",
  kentucky: "ky",
  louisiana: "la",
  maine: "me",
  maryland: "md",
  massachusetts: "ma",
  michigan: "mi",
  minnesota: "mn",
  mississippi: "ms",
  missouri: "mo",
  montana: "mt",
  nebraska: "ne",
  nevada: "nv",
  "new hampshire": "nh",
  "new jersey": "nj",
  "new mexico": "nm",
  "new york": "ny",
  "north carolina": "nc",
  "north dakota": "nd",
  ohio: "oh",
  oklahoma: "ok",
  oregon: "or",
  pennsylvania: "pa",
  "rhode island": "ri",
  "south carolina": "sc",
  "south dakota": "sd",
  tennessee: "tn",
  texas: "tx",
  utah: "ut",
  vermont: "vt",
  virginia: "va",
  washington: "wa",
  "west virginia": "wv",
  wisconsin: "wi",
  wyoming: "wy",
};

function normalizeState(str) {
  if (!str) return "";
  const clean = str.toLowerCase().trim().replace(/\./g, "");
  if (clean.length === 2) return clean; // Already a code
  return STATE_MAP[clean] || clean; // Convert or return original
}

function tokenMatch(a, b) {
  const t1 = new Set(a.split(" "));
  const t2 = new Set(b.split(" "));
  const intersection = [...t1].filter((x) => t2.has(x));
  return intersection.length / Math.max(t1.size, t2.size);
}

function auditSimilarity(a, b) {
  if (!a || !b) return 0;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) == a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1),
        );
      }
    }
  }
  return 1 - matrix[b.length][a.length] / Math.max(a.length, b.length);
}

// ==========================================
// DATA FETCHING (Unchanged logic)
// ==========================================

async function fetchAssetsForAudit(apiKey, accountId, signal) {
  let allAssets = [];
  let nextUrl = `https://api.sightmap.com/v1/accounts/${accountId}/assets?per-page=100`;
  while (nextUrl) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const res = await fetch(nextUrl, {
      headers: { "API-Key": apiKey, "Experimental-Flags": "accounts-assets" },
      signal,
    });
    if (!res.ok) throw new Error(`Failed to fetch assets: ${res.status}.`);
    const json = await res.json();
    allAssets = allAssets.concat(json.data || []);
    nextUrl = json.paging && json.paging.next_url ? json.paging.next_url : null;
    const pct = nextUrl ? 25 : 50;
    document.getElementById("auditProgressBar").style.width = `${pct}%`;
    updateAuditStatus(`Fetching Assets... (${allAssets.length})`);
  }
  return allAssets;
}

async function buildAuditReferenceMap(apiKey, assets, signal) {
  const refMap = new Map();
  const BATCH_SIZE = 10;
  let processed = 0;
  for (let i = 0; i < assets.length; i += BATCH_SIZE) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const batch = assets.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (asset) => {
      try {
        const url = `https://api.sightmap.com/v1/assets/${asset.id}/multifamily/references?per-page=100`;
        const res = await fetch(url, {
          headers: { "API-Key": apiKey, "Experimental-Flags": "references" },
          signal,
        });
        if (res.ok) {
          const json = await res.json();
          const refs = json.data || [];
          asset.auditRefs = refs;
          refs.forEach((ref) => {
            if (ref.value)
              refMap.set(String(ref.value).trim().toLowerCase(), asset);
          });
        }
      } catch (e) {}
    });
    await Promise.all(promises);
    processed += batch.length;
    const pct = 50 + Math.floor((processed / assets.length) * 40);
    document.getElementById("auditProgressBar").style.width = `${pct}%`;
    updateAuditStatus(`Deep Scanning: ${processed}/${assets.length} assets...`);
  }
  return refMap;
}

// ==========================================
// PARSING & RENDERING (Unchanged logic)
// ==========================================

function parseAuditCSV(text) {
  const lines = text.split(/\r\n|\n/).filter((l) => l.trim());
  const headerLine = lines[0].toLowerCase();
  const headers = headerLine.split(",");
  const getIdx = (k) => headers.findIndex((h) => h.includes(k));
  const idx = {
    id: getIdx("asset_id"),
    ref: getIdx("ref"),
    name: getIdx("name"),
    addr: getIdx("address"),
    city: getIdx("city"),
    state: getIdx("state"),
  };
  const startRow = idx.name > -1 || idx.addr > -1 ? 1 : 0;
  const rows = [];
  for (let i = startRow; i < lines.length; i++) {
    const cols = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    const clean = (v) => (v ? v.trim().replace(/^"|"$/g, "").trim() : "");
    if (cols.length < 2 && !cols[0]) continue;
    let row = {};
    if (idx.name > -1) {
      row = {
        asset_id: idx.id > -1 ? clean(cols[idx.id]) : "",
        ref_id: idx.ref > -1 ? clean(cols[idx.ref]) : "",
        name: idx.name > -1 ? clean(cols[idx.name]) : "",
        address: idx.addr > -1 ? clean(cols[idx.addr]) : "",
        city: idx.city > -1 ? clean(cols[idx.city]) : "",
        state: idx.state > -1 ? clean(cols[idx.state]) : "",
      };
    } else {
      row = {
        asset_id: clean(cols[0]),
        ref_id: clean(cols[1]),
        name: clean(cols[2]),
        address: clean(cols[3]),
        city: clean(cols[4]),
        state: clean(cols[5]),
      };
    }
    rows.push(row);
  }
  return rows;
}

function renderAuditResults(results) {
  const tbody = document.querySelector("#auditTable tbody");
  tbody.innerHTML = "";
  results.forEach((r) => {
    let badgeColor = "#52525b";
    if (r.status === "MATCHED") badgeColor = "#4ade80";
    if (r.status === "UNCERTAIN") badgeColor = "#facc15";
    const m = r.match || {};
    let mRefs = "-";
    if (m.auditRefs && m.auditRefs.length > 0) {
      mRefs = m.auditRefs
        .slice(0, 3)
        .map((ref) => ref.value)
        .join(", ");
      if (m.auditRefs.length > 3) mRefs += "...";
    }
    const row = `<tr>
        <td><span class="match-tag" style="background-color:${badgeColor}; color:#000;">${r.status}</span></td>
        <td style="font-size:0.85rem;">${r.method}</td>
        <td style="font-family:monospace; color:#ccc;">${r.input.asset_id || ""}</td>
        <td style="font-family:monospace; color:#ccc;">${r.input.ref_id || ""}</td>
        <td>${r.input.name}</td>
        <td style="color:#aaa;">${r.input.address || ""}</td>
        <td style="color:#aaa;">${r.input.city || ""}</td>
        <td style="color:#aaa;">${r.input.state || ""}</td>
        <td style="font-family:monospace; color:var(--accent-light); font-weight:bold;">${m.id || "-"}</td>
        <td style="font-family:monospace; color:var(--accent-light);">${mRefs}</td>
        <td style="color:#fff;">${m.name || "-"}</td>
        <td style="color:#aaa;">${m.address_line1 || "-"}</td>
        <td style="color:#aaa;">${m.address_city || "-"}</td>
        <td style="color:#aaa;">${m.address_state || "-"}</td>
      </tr>`;
    tbody.insertAdjacentHTML("beforeend", row);
  });
  document.getElementById("auditCount").textContent = results.length;
}

function resetAuditUI() {
  auditResults = [];
  document.querySelector("#auditTable tbody").innerHTML = "";
  document.getElementById("auditProgressBar").style.width = "0%";
  document.getElementById("auditStatusMsg").textContent = "Initializing...";
}

function updateAuditStatus(msg) {
  document.getElementById("auditStatusMsg").textContent = msg;
}

function downloadAuditCSV() {
  // ... existing logic ...
  if (auditResults.length === 0) {
    alert("No results.");
    return;
  }
  let csv =
    "Status,Method,Score,Input_ID,Input_Ref_ID,Input_Name,Input_Address,Input_City,Input_State,Matched_Asset_ID,Matched_Ref_IDs,Matched_Name,Matched_Address,Matched_City,Matched_State\n";
  auditResults.forEach((r) => {
    const i = r.input;
    const m = r.match || {};
    const safe = (str) => `"${(str || "").replace(/"/g, '""')}"`;
    let mRefs = "";
    if (m.auditRefs) mRefs = m.auditRefs.map((ref) => ref.value).join(" | ");
    csv += `${r.status},"${r.method}",${r.score},${safe(i.asset_id)},${safe(i.ref_id)},${safe(i.name)},${safe(i.address)},${safe(i.city)},${safe(i.state)},${m.id || ""},${safe(mRefs)},${safe(m.name)},${safe(m.address_line1)},${safe(m.address_city)},${safe(m.address_state)}\n`;
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "audit_results.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function copyAuditTable() {
  // ... existing logic ...
  if (auditResults.length === 0) {
    alert("No results.");
    return;
  }
  let text =
    "Status\tMethod\tInput Name\tMatched ID\tMatched Ref\tMatched Name\n";
  auditResults.forEach((r) => {
    const m = r.match || {};
    let mRefs = "";
    if (m.auditRefs) mRefs = m.auditRefs.map((ref) => ref.value).join(", ");
    text += `${r.status}\t${r.method}\t${r.input.name}\t${m.id || ""}\t${mRefs}\t${m.name || ""}\n`;
  });
  navigator.clipboard.writeText(text);
  alert("Copied!");
}

function calculateAndShowUnmatched() {
  const matchedIds = new Set();
  auditResults.forEach((r) => {
    if (r.match && r.match.id) matchedIds.add(String(r.match.id));
  });
  unmatchedAssets = currentAccountAssets.filter(
    (asset) => !matchedIds.has(String(asset.id)),
  );
  const tbody = document.querySelector("#unmatchedTable tbody");
  tbody.innerHTML = "";
  document.getElementById("unmatchedCount").textContent =
    unmatchedAssets.length;
  unmatchedAssets.forEach((asset) => {
    const row = `<tr><td style="font-family:monospace; color:var(--accent-light); font-weight:bold;">${asset.id}</td><td>${asset.name}</td><td>${asset.address_line1 || "-"}</td><td>${asset.address_city || "-"}</td><td>${asset.address_state || "-"}</td></tr>`;
    tbody.insertAdjacentHTML("beforeend", row);
  });
}

function copyUnmatchedTable() {
  if (unmatchedAssets.length === 0) {
    alert("No unmatched assets.");
    return;
  }
  let text = "Asset ID\tName\tAddress\tCity\tState\n";
  unmatchedAssets.forEach((a) => {
    text += `${a.id}\t${a.name}\t${a.address_line1 || ""}\t${a.address_city || ""}\t${a.address_state || ""}\n`;
  });
  navigator.clipboard.writeText(text);
  alert("Copied!");
}

function downloadUnmatchedCSV() {
  if (unmatchedAssets.length === 0) {
    alert("No unmatched assets.");
    return;
  }
  let csv = "Asset_ID,Name,Address,City,State\n";
  const safe = (str) => `"${(str || "").replace(/"/g, '""')}"`;
  unmatchedAssets.forEach((a) => {
    csv += `${a.id},${safe(a.name)},${safe(a.address_line1)},${safe(a.address_city)},${safe(a.address_state)}\n`;
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "unmatched_account_assets.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function calculateAndShowUnmatchedInputs() {
  unmatchedInputs = auditResults
    .filter((r) => r.status !== "MATCHED" && r.status !== "UNCERTAIN")
    .map((r) => r.input);
  const tbody = document.querySelector("#unmatchedInputTable tbody");
  tbody.innerHTML = "";
  document.getElementById("unmatchedInputCount").textContent =
    unmatchedInputs.length;
  unmatchedInputs.forEach((i) => {
    const row = `<tr><td style="font-family:monospace; color:#ccc;">${i.asset_id || "-"}</td><td style="font-family:monospace; color:#ccc;">${i.ref_id || "-"}</td><td>${i.name}</td><td>${i.address || "-"}</td><td>${i.city || "-"}</td><td>${i.state || "-"}</td></tr>`;
    tbody.insertAdjacentHTML("beforeend", row);
  });
}

function copyUnmatchedInputTable() {
  if (unmatchedInputs.length === 0) {
    alert("No unmatched inputs.");
    return;
  }
  let text = "Input ID\tRef ID\tName\tAddress\tCity\tState\n";
  unmatchedInputs.forEach((i) => {
    text += `${i.asset_id || ""}\t${i.ref_id || ""}\t${i.name}\t${i.address || ""}\t${i.city || ""}\t${i.state || ""}\n`;
  });
  navigator.clipboard.writeText(text);
  alert("Copied!");
}

function downloadUnmatchedInputCSV() {
  if (unmatchedInputs.length === 0) {
    alert("No unmatched inputs.");
    return;
  }
  let csv = "Input_ID,Ref_ID,Name,Address,City,State\n";
  const safe = (str) => `"${(str || "").replace(/"/g, '""')}"`;
  unmatchedInputs.forEach((i) => {
    csv += `${safe(i.asset_id)},${safe(i.ref_id)},${safe(i.name)},${safe(i.address)},${safe(i.city)},${safe(i.state)}\n`;
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "unmatched_inputs.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
