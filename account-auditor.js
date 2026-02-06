/* account-auditor.js */

let auditResults = [];
let currentAccountAssets = []; // Store fetched assets to compare later
let auditAbortController = null;
let unmatchedAssets = []; // Store the diff for the modal

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

  // --- Unmatched Modal Logic ---
  const unmatchedBtn = document.getElementById("showUnmatchedBtn");
  const unmatchedModal = document.getElementById("unmatchedModal");
  const closeUnmatched = document.getElementById("closeUnmatchedModal");
  const copyUnmatched = document.getElementById("copyUnmatchedBtn");
  const dlUnmatched = document.getElementById("downloadUnmatchedBtn");

  if (unmatchedBtn) {
    unmatchedBtn.addEventListener("click", () => {
      calculateAndShowUnmatched();
      unmatchedModal.style.display = "block";
    });
  }

  if (closeUnmatched) {
    closeUnmatched.addEventListener("click", () => {
      unmatchedModal.style.display = "none";
    });
  }

  // Close modal when clicking outside
  window.addEventListener("click", (e) => {
    if (e.target === unmatchedModal) unmatchedModal.style.display = "none";
  });

  if (copyUnmatched)
    copyUnmatched.addEventListener("click", copyUnmatchedTable);
  if (dlUnmatched) dlUnmatched.addEventListener("click", downloadUnmatchedCSV);
});

// ==========================================
// MAIN RUN FUNCTION
// ==========================================
async function runAccountAudit() {
  const apiKey = document.getElementById("apiKey").value.trim();
  const accountId = document.getElementById("auditAccountId").value.trim();
  const fileInput = document.getElementById("auditCsvFile");
  const forceSkipRefs = document.getElementById("auditSkipRefs").checked;
  const unmatchedBtn = document.getElementById("showUnmatchedBtn");

  if (!apiKey || !accountId) {
    alert("API Key and Account ID are required.");
    return;
  }
  if (fileInput.files.length === 0) {
    alert("Please select a CSV file.");
    return;
  }

  // Hide unmatched button until done
  if (unmatchedBtn) unmatchedBtn.style.display = "none";

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

      // 1. Fetch Assets
      const assets = await fetchAssetsForAudit(
        apiKey,
        accountId,
        auditAbortController.signal
      );
      currentAccountAssets = assets; // Store globally for the unmatched modal

      if (assets.length === 0) {
        updateAuditStatus("No assets found in this account.");
        return;
      }

      // 2. Fetch References
      const csvHasRefs = csvData.some((r) => r.ref_id);
      let refMap = new Map();

      if (csvHasRefs && !forceSkipRefs) {
        updateAuditStatus(
          `Step 2: Deep Scanning references for ${assets.length} assets...`
        );
        refMap = await buildAuditReferenceMap(
          apiKey,
          assets,
          auditAbortController.signal
        );
      } else {
        updateAuditStatus("Skipping reference fetch (Optimization).");
        document.getElementById("auditProgressBar").style.width = "60%";
      }

      // 3. Perform Matching
      updateAuditStatus("Step 3: Auditing data...");
      await new Promise((r) => setTimeout(r, 50));

      auditResults = performAuditMatching(csvData, assets, refMap);
      renderAuditResults(auditResults);

      const matchCount = auditResults.filter(
        (r) => r.status === "MATCHED"
      ).length;
      updateAuditStatus(
        `✅ Audit Complete. Matched ${matchCount} / ${auditResults.length} rows.`
      );
      document.getElementById("auditProgressBar").style.width = "100%";

      // Show Unmatched Button
      if (unmatchedBtn) unmatchedBtn.style.display = "inline-block";
    } catch (err) {
      if (err.name === "AbortError") {
        updateAuditStatus("Audit Cancelled.");
      } else {
        console.error(err);
        updateAuditStatus(`Error: ${err.message}`);
      }
    }
  };
  reader.readAsText(file);
}

// ==========================================
// UNMATCHED ASSETS LOGIC
// ==========================================
function calculateAndShowUnmatched() {
  // 1. Get Set of IDs that WERE matched
  const matchedIds = new Set();
  auditResults.forEach((r) => {
    if (r.match && r.match.id) {
      matchedIds.add(String(r.match.id));
    }
  });

  // 2. Filter Account Assets
  unmatchedAssets = currentAccountAssets.filter(
    (asset) => !matchedIds.has(String(asset.id))
  );

  // 3. Render Table
  const tbody = document.querySelector("#unmatchedTable tbody");
  tbody.innerHTML = "";
  document.getElementById("unmatchedCount").textContent =
    unmatchedAssets.length;

  unmatchedAssets.forEach((asset) => {
    const row = `
            <tr>
                <td style="font-family:monospace; color:var(--accent-light); font-weight:bold;">${asset.id}</td>
                <td>${asset.name}</td>
                <td>${asset.address_line1 || "-"}</td>
                <td>${asset.address_city || "-"}</td>
                <td>${asset.address_state || "-"}</td>
            </tr>
        `;
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
  alert("Copied unmatched list!");
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
  link.download = "unmatched_assets.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ==========================================
// DATA FETCHING
// ==========================================

async function fetchAssetsForAudit(apiKey, accountId, signal) {
  let allAssets = [];
  let nextUrl = `https://api.sightmap.com/v1/accounts/${accountId}/assets?per-page=100`;

  while (nextUrl) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    const res = await fetch(nextUrl, {
      headers: {
        "API-Key": apiKey,
        "Experimental-Flags": "accounts-assets",
      },
      signal,
    });

    if (!res.ok)
      throw new Error(
        `Failed to fetch assets: ${res.status}. Check API Key/Account ID.`
      );

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
      } catch (e) {
        console.warn(`Ref fetch failed for ${asset.id}`, e);
      }
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
// MATCHING LOGIC
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
    // 3. Fuzzy
    else {
      let candidates = assets;
      if (row.state) {
        const rowState = row.state.trim().toLowerCase();
        const stateFiltered = assets.filter(
          (a) => a.address_state && a.address_state.toLowerCase() === rowState
        );
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

      if (bestScore > 0.75) {
        match = bestAsset;
        method = `Fuzzy (${(bestScore * 100).toFixed(0)}%)`;
        score = bestScore;
      } else if (bestScore > 0.5) {
        match = bestAsset;
        method = `Weak Fuzzy (${(bestScore * 100).toFixed(0)}%)`;
        score = bestScore;
      }
    }

    let status = "MISSING";
    if (match)
      status =
        score > 0.75 || method.includes("Exact") ? "MATCHED" : "UNCERTAIN";

    return { status, method, score, input: row, match: match };
  });
}

function calculateAuditFuzzyScore(row, asset) {
  const norm = (str) =>
    (str || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[.,'’"#-]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const rowAddr = norm(row.address);
  const rowName = norm(row.name);
  const rowCity = norm(row.city);

  const assetAddr = norm(asset.address_line1);
  const assetName = norm(asset.name);
  const assetCity = norm(asset.address_city);

  let addrScore = 0;
  if (rowAddr && assetAddr) {
    if (rowAddr === assetAddr) addrScore = 1;
    else if (rowAddr.includes(assetAddr) || assetAddr.includes(rowAddr))
      addrScore = 0.9;
    else {
      const sim = auditSimilarity(rowAddr, assetAddr);
      if (sim > 0.8) addrScore = sim;
    }
  }

  let nameScore = 0;
  if (rowName && assetName) {
    if (rowName === assetName) nameScore = 1;
    else if (rowName.includes(assetName) || assetName.includes(rowName))
      nameScore = 0.8;
    else {
      const sim = auditSimilarity(rowName, assetName);
      if (sim > 0.6) nameScore = sim;
    }
  }

  if (rowCity && assetCity && rowCity !== assetCity) {
    if (addrScore < 1) return 0;
  }

  if (rowAddr) return addrScore * 0.7 + nameScore * 0.3;
  return nameScore;
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
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
        );
      }
    }
  }
  return 1 - matrix[b.length][a.length] / Math.max(a.length, b.length);
}

// ==========================================
// PARSING & UI
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
    const mAddr = m.address_line1 || "";
    const mCity = m.address_city || "";
    const mState = m.address_state || "";

    let mRefs = "-";
    if (m.auditRefs && m.auditRefs.length > 0) {
      mRefs = m.auditRefs
        .slice(0, 3)
        .map((ref) => ref.value)
        .join(", ");
      if (m.auditRefs.length > 3) mRefs += "...";
    }

    const row = `
      <tr>
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
        <td style="color:#aaa;">${mAddr}</td>
        <td style="color:#aaa;">${mCity}</td>
        <td style="color:#aaa;">${mState}</td>
      </tr>
    `;
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
