/* reference-match.js */

let refMatchResults = [];
let refAbortController = null;

document.addEventListener("DOMContentLoaded", () => {
  // Option A & B Buttons
  const singleBtn = document.getElementById("runSingleRefMatchBtn");
  if (singleBtn) singleBtn.addEventListener("click", runSingleRefMatch);

  const bulkBtn = document.getElementById("runBulkRefMatchBtn");
  if (bulkBtn) bulkBtn.addEventListener("click", runBulkRefMatch);

  // Utils
  const dlBtn = document.getElementById("downloadRefMatchBtn");
  if (dlBtn) dlBtn.addEventListener("click", downloadRefMatchCSV);

  const cpBtn = document.getElementById("copyRefMatchClipBtn");
  if (cpBtn) cpBtn.addEventListener("click", copyRefMatchTable);

  const globalCheck = document.getElementById("globalRefSearchCheck");
  if (globalCheck) globalCheck.addEventListener("change", toggleRefGlobalInput);

  // LOCAL STOP BUTTON LISTENER
  const stopBtn = document.getElementById("stopRefMatchBtn");
  if (stopBtn) {
    stopBtn.addEventListener("click", () => {
      if (refAbortController) refAbortController.abort();
      stopBtn.style.display = "none";
    });
  }

  // GLOBAL KILL SWITCH LISTENER
  window.addEventListener("killAllProcesses", () => {
    if (refAbortController) {
      refAbortController.abort();
      const localStopBtn = document.getElementById("stopRefMatchBtn");
      if (localStopBtn) localStopBtn.style.display = "none";
      updateRefMatchStatus("🛑 Process globally terminated.");
    }
  });

  // Template Download
  const tmplLink = document.getElementById("refMatchTemplateLink");
  if (tmplLink) {
    const newLink = tmplLink.cloneNode(true);
    tmplLink.parentNode.replaceChild(newLink, tmplLink);
    newLink.addEventListener("click", (e) => {
      e.preventDefault();
      const csvContent =
        "Property Name,Reference ID\nGreenwood Apartments,12345\nSunrise Villas,99-88-77";
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "reference_match_template.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }
});

function toggleRefGlobalInput(e) {
  const accountInput = document.getElementById("refMatchAccountId");
  if (e.target.checked) {
    accountInput.disabled = true;
    accountInput.style.opacity = "0.5";
    accountInput.placeholder = "Global Search Enabled (Account ID ignored)";
  } else {
    accountInput.disabled = false;
    accountInput.style.opacity = "1";
    accountInput.placeholder = "Account ID (Required)";
  }
}

function getRefCoreParams() {
  const apiKey = document.getElementById("apiKey").value.trim();
  const accountId = document.getElementById("refMatchAccountId").value.trim();
  const isGlobal = document.getElementById("globalRefSearchCheck").checked;
  const filterKey = document.getElementById("refMatchKey").value.trim();

  if (!apiKey) {
    alert("Please enter API Key.");
    return null;
  }
  if (!isGlobal && !accountId) {
    alert("Please enter Account ID or check Global Search.");
    return null;
  }

  return { apiKey, accountId, isGlobal, filterKey };
}

// ==========================================
// OPTION A: SINGLE SEARCH
// ==========================================
async function runSingleRefMatch() {
  const params = getRefCoreParams();
  if (!params) return;

  const name = document.getElementById("refSingleName").value.trim();
  const refId = document.getElementById("refSingleId").value.trim();

  if (!name && !refId) {
    alert(
      "Please provide either a Property Name or a Reference ID for a single search.",
    );
    return;
  }

  const inputRows = [{ propertyName: name, refId: refId }];
  await executeRefMatchCore(params, inputRows);
}

// ==========================================
// OPTION B: BULK SEARCH
// ==========================================
async function runBulkRefMatch() {
  const params = getRefCoreParams();
  if (!params) return;

  const fileInput = document.getElementById("refMatchCsvFile");
  if (fileInput.files.length === 0) {
    alert("Please select a CSV.");
    return;
  }

  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = async function (e) {
    const csvText = e.target.result;
    const lines = csvText.split(/\r?\n/).filter(Boolean);

    const header = lines[0].toLowerCase();
    let nameIdx = 0;
    let refIdx = 1;

    if (
      header.includes("name") ||
      header.includes("property") ||
      header.includes("reference") ||
      header.includes("id")
    ) {
      const parts = header.split(",");
      parts.forEach((p, i) => {
        if (p.includes("ref") || p.includes("id")) refIdx = i;
        if (p.includes("name") || p.includes("property")) nameIdx = i;
      });
      lines.shift();
    }

    const inputRows = lines.map((line) => {
      const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
      const clean = (v) => (v ? v.trim().replace(/^"|"$/g, "").trim() : "");
      return {
        propertyName: clean(parts[nameIdx]),
        refId: clean(parts[refIdx]),
      };
    });

    if (inputRows.length === 0) {
      alert("No valid rows found.");
      return;
    }

    await executeRefMatchCore(params, inputRows);
  };

  reader.readAsText(file);
}

// ==========================================
// CORE EXECUTION ENGINE
// ==========================================
async function executeRefMatchCore(params, inputRows) {
  const { apiKey, accountId, isGlobal, filterKey } = params;

  if (refAbortController) refAbortController.abort();
  refAbortController = new AbortController();

  resetRefMatchUI();

  // SHOW BUTTON ON START
  const stopBtn = document.getElementById("stopRefMatchBtn");
  if (stopBtn) stopBtn.style.display = "inline-block";

  updateRefMatchStatus("Step 1/2: Fetching Asset List...");
  let url = isGlobal
    ? `https://api.sightmap.com/v1/assets?per-page=250`
    : `https://api.sightmap.com/v1/accounts/${accountId}/assets?per-page=250`;

  try {
    const assets = await fetchAssetList(apiKey, url, refAbortController.signal);

    const keyStatusMsg = filterKey ? ` (Filtered by Key: ${filterKey})` : "";
    updateRefMatchStatus(
      `Step 2/2: Deep Scanning ${assets.length} assets for references${keyStatusMsg}...`,
    );

    const enrichedAssets = await enrichAssetsWithReferences(
      apiKey,
      assets,
      filterKey,
      refAbortController.signal,
    );

    updateRefMatchProgressBar(100);
    updateRefMatchStatus(
      `Matching ${inputRows.length} inputs against ${enrichedAssets.length} assets...`,
    );

    // Matching logic
    const matches = performRefMatching(inputRows, enrichedAssets);
    renderRefResults(matches);
    refMatchResults = matches;

    updateRefMatchStatus(
      `Process Complete. Found ${matches.filter((m) => m.matchedId).length} matches.`,
    );
  } catch (error) {
    if (error.name === "AbortError") {
      updateRefMatchStatus("🛑 Process Stopped.");
    } else {
      console.error(error);
      updateRefMatchStatus(`Error: ${error.message}`);
    }
  } finally {
    // HIDE BUTTON ON SUCCESS OR ERROR
    if (stopBtn) stopBtn.style.display = "none";
  }
}

// STEP 1: Fetch Basic Asset List
async function fetchAssetList(apiKey, initialUrl, signal) {
  let allAssets = [];
  let nextUrl = initialUrl;
  let totalCount = 0;

  while (nextUrl) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    const response = await fetch(nextUrl, {
      method: "GET",
      headers: {
        "API-Key": apiKey,
        "Experimental-Flags": "accounts-assets",
      },
      signal,
    });

    if (!response.ok) throw new Error(`List API Error: ${response.status}`);

    const json = await response.json();
    const data = json.data || [];
    allAssets = allAssets.concat(data);

    if (json.paging && json.paging.total_count)
      totalCount = json.paging.total_count;
    nextUrl = json.paging ? json.paging.next_url : null;

    let percent =
      totalCount > 0 ? Math.floor((allAssets.length / totalCount) * 50) : 25;
    updateRefMatchProgressBar(percent);
    updateRefMatchStatus(
      `Fetching Asset List... ${allAssets.length} / ${totalCount || "?"}`,
    );

    await new Promise((r) => setTimeout(r, 0));
  }
  return allAssets;
}

// STEP 2: Enrich Assets (NEW ENDPOINT USAGE)
async function enrichAssetsWithReferences(apiKey, assets, filterKey, signal) {
  let completed = 0;
  const total = assets.length;
  const BATCH_SIZE = 5;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    const batch = assets.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (asset) => {
        try {
          let url = `https://api.unitmap.com/v1/assets/references?asset=${asset.id}&per-page=1000`;

          if (filterKey) {
            url += `&key=${encodeURIComponent(filterKey)}`;
          }

          const res = await fetch(url, {
            method: "GET",
            headers: {
              "API-Key": apiKey,
              "Experimental-Flags": "references",
            },
            signal,
          });

          if (res.ok) {
            const json = await res.json();
            asset.references = json.data || [];
          } else {
            asset.references = [];
          }
        } catch (err) {
          console.warn(`Failed ref fetch for asset ${asset.id}`, err);
          asset.references = [];
        }
      }),
    );

    completed += batch.length;
    const percent = 50 + Math.floor((completed / total) * 50);
    updateRefMatchProgressBar(percent);
    updateRefMatchStatus(
      `Deep Scanning: Fetched references for ${completed} / ${total} assets...`,
    );

    await new Promise((r) => setTimeout(r, 10));
  }
  return assets;
}

// STEP 3: Matching Logic
function performRefMatching(rows, assets) {
  return rows.map((row) => {
    const inputRef = row.refId ? String(row.refId).trim().toLowerCase() : "";
    const inputName = normalizeRefString(row.propertyName);

    let best = { score: 0, asset: null, method: "None" };

    for (const asset of assets) {
      let currentScore = 0;
      let matchMethod = "";

      // A. CHECK REFERENCES (Exact Match)
      let hasRefMatch = false;
      if (inputRef && asset.references && asset.references.length > 0) {
        hasRefMatch = asset.references.some((r) => {
          const val =
            typeof r === "object" && r.value ? String(r.value) : String(r);
          return val.trim().toLowerCase() === inputRef;
        });
      }

      if (hasRefMatch) {
        currentScore = 1.0;
        matchMethod = "Reference ID (Exact)";
      } else if (inputName) {
        // B. CHECK FUZZY NAME (Fallback)
        const aName = normalizeRefString(asset.name);
        const sim = similarityRef(inputName, aName);
        const tok = tokenMatchScoreRef(inputName, aName);

        currentScore = (sim * 0.6 + tok * 0.4) * 0.9;
        matchMethod = "Fuzzy Name";
      }

      if (currentScore > best.score) {
        best = { score: currentScore, asset: asset, method: matchMethod };
        if (best.score === 1.0) break;
      }
    }

    return {
      score: best.score.toFixed(3),
      scoreStyle: getRefScoreStyle(best.score),
      inputRef: row.refId || "-",
      inputName: row.propertyName || "-",
      matchedId: best.asset ? best.asset.id : "",
      matchedName: best.asset ? best.asset.name : "No Match",
      matchedRefIds: getAssetRefString(best.asset),
      location: getRefAssetLocation(best.asset),
      method: best.score > 0 ? best.method : "-",
    };
  });
}

// Helpers
function getAssetRefString(asset) {
  if (!asset || !asset.references || asset.references.length === 0) return "";
  return asset.references
    .map((r) => {
      if (typeof r === "object") return `${r.key || "id"}: ${r.value}`;
      return String(r);
    })
    .join(" | ");
}

function getRefAssetLocation(asset) {
  if (!asset) return "";
  const city =
    asset.address_city || (asset.address ? asset.address.city : "") || "";
  const state =
    asset.address_state || (asset.address ? asset.address.state : "") || "";
  if (city && state) return `${city}, ${state}`;
  return city || state || "N/A";
}

function normalizeRefString(str) {
  if (!str) return "";
  return str
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,'’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function levenshteinRef(a, b) {
  if (a === b) return 0;
  if (!a || !b) return Math.max(a.length, b.length);
  const v0 = new Array(b.length + 1);
  const v1 = new Array(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v1[b.length];
}

function similarityRef(a, b) {
  if (!a || !b) return 0;
  return 1 - levenshteinRef(a, b) / Math.max(a.length, b.length);
}

function tokenMatchScoreRef(a, b) {
  const t1 = new Set(normalizeRefString(a).split(" "));
  const t2 = new Set(normalizeRefString(b).split(" "));
  const inter = [...t1].filter((t) => t2.has(t));
  return inter.length / Math.max(t1.size, 1);
}

function getRefScoreStyle(score) {
  const s = parseFloat(score);
  if (s >= 1.0) return "background-color:#22c55e;color:white;";
  if (s >= 0.8) return "background-color:#eab308;color:black;";
  if (s >= 0.6) return "background-color:#f97316;color:white;";
  return "background-color:#52525b;color:white;";
}

function renderRefResults(matches) {
  matches.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));

  const tbody = document.querySelector("#refMatchTable tbody");
  tbody.innerHTML = "";
  const countSpan = document.getElementById("refMatchCount");
  if (countSpan) countSpan.textContent = matches.length;

  matches.forEach((m) => {
    const row = `
            <tr>
                <td><span style="display:inline-block; padding:4px 8px; border-radius:4px; font-weight:bold; ${m.scoreStyle}">${m.score}</span></td>
                <td style="font-family:monospace; color:#bbb;">${m.inputRef}</td>
                <td style="color:#e0e0e0;">${m.inputName}</td>
                <td style="font-family:monospace; color:var(--accent-light); font-weight:bold;">${m.matchedId}</td>
                <td>${m.matchedName}</td>
                <td style="font-family:monospace; font-size:0.85em; color:#ddd; max-width:250px; overflow-wrap:anywhere;">${m.matchedRefIds}</td>
                <td style="font-size:0.9em; color:#999;">${m.location}</td>
                <td style="font-size:0.85em;">${m.method}</td>
            </tr>
        `;
    tbody.insertAdjacentHTML("beforeend", row);
  });
}

function resetRefMatchUI() {
  refMatchResults = [];
  document.querySelector("#refMatchTable tbody").innerHTML = "";
  updateRefMatchProgressBar(0);
  const countSpan = document.getElementById("refMatchCount");
  if (countSpan) countSpan.textContent = "0";
  updateRefMatchStatus("Starting search...");
}

function updateRefMatchStatus(msg) {
  const el = document.getElementById("refMatchStatusMsg");
  if (el) el.textContent = msg;
}

function updateRefMatchProgressBar(percent) {
  const bar = document.getElementById("refMatchProgressBar");
  if (bar) {
    bar.style.width = `${percent}%`;
    bar.textContent = `${percent}%`;
  }
}

function downloadRefMatchCSV() {
  if (refMatchResults.length === 0) {
    alert("No data to download");
    return;
  }
  let csvContent =
    "Input Ref ID,Input Name,Match Score,Match Method,Matched Asset ID,Matched Name,Matched Ref IDs,Location\n";
  refMatchResults.forEach((r) => {
    const cleanName = r.inputName.replace(/"/g, '""');
    const cleanMatch = r.matchedName.replace(/"/g, '""');
    const cleanRefs = r.matchedRefIds.replace(/"/g, '""');
    csvContent += `"${r.inputRef}","${cleanName}",${r.score},"${r.method}",${r.matchedId},"${cleanMatch}","${cleanRefs}","${r.location}"\n`;
  });

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "reference_match_results.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function copyRefMatchTable() {
  if (refMatchResults.length === 0) {
    alert("No data");
    return;
  }
  let text =
    "Score\tInput Ref\tInput Name\tMatched ID\tMatched Name\tMatched Ref IDs\tLocation\tMethod\n";
  refMatchResults.forEach((r) => {
    text += `${r.score}\t${r.inputRef}\t${r.inputName}\t${r.matchedId}\t${r.matchedName}\t${r.matchedRefIds}\t${r.location}\t${r.method}\n`;
  });
  navigator.clipboard.writeText(text);
  alert("Table copied to clipboard!");
}
