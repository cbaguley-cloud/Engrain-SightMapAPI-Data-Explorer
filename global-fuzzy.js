let gfResults = [];
let top5Candidates = []; // Stores the top 5 for the modal
let gfAbortController = null; // Added AbortController

document.addEventListener("DOMContentLoaded", () => {
  // Option A: Single
  const runBtn = document.getElementById("runGlobalFuzzyBtn");
  if (runBtn) runBtn.addEventListener("click", runGlobalFuzzyMatch);

  // Option B: Bulk
  const bulkBtn = document.getElementById("bulkGlobalFuzzyBtn");
  if (bulkBtn) bulkBtn.addEventListener("click", runBulkGlobalFuzzyMatch);

  // Utils
  const dlBtn = document.getElementById("downloadGfBtn");
  if (dlBtn) dlBtn.addEventListener("click", downloadGfCSV);

  const copyBtn = document.getElementById("copyGfClipBtn");
  if (copyBtn) copyBtn.addEventListener("click", copyGfTable);

  // LOCAL STOP BUTTON
  const stopBtn = document.getElementById("stopGfBtn");
  if (stopBtn) {
    stopBtn.addEventListener("click", () => {
      if (gfAbortController) gfAbortController.abort();
      stopBtn.style.display = "none";
    });
  }

  // GLOBAL KILL SWITCH LISTENER
  window.addEventListener("killAllProcesses", () => {
    if (gfAbortController) {
      gfAbortController.abort();
      const localStopBtn = document.getElementById("stopGfBtn");
      if (localStopBtn) localStopBtn.style.display = "none";
      updateGfStatus("🛑 Process globally terminated.");
    }
  });

  // Modal Logic
  const modal = document.getElementById("top5Modal");
  const btn = document.getElementById("showTop5Btn");
  const closeSpan = document.getElementsByClassName("close-modal")[0];

  if (btn)
    btn.addEventListener("click", () => {
      renderTop5Modal();
      modal.style.display = "block";
    });

  if (closeSpan)
    closeSpan.addEventListener("click", () => {
      modal.style.display = "none";
    });

  window.addEventListener("click", (event) => {
    if (event.target == modal) {
      modal.style.display = "none";
    }
  });

  // Template
  const tmplLink = document.getElementById("gfTemplateLink");
  if (tmplLink) {
    tmplLink.addEventListener("click", (e) => {
      e.preventDefault();
      const csvContent = "Property Name,Address,City,State";
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", "global_fuzzy_template.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }
});

// OPTION A: Single Search (With Top 5 Feature)
async function runGlobalFuzzyMatch() {
  const apiKey = document.getElementById("apiKey").value.trim();
  const name = document.getElementById("gfName").value.trim();
  const address = document.getElementById("gfAddress").value.trim();
  const city = document.getElementById("gfCity").value.trim();
  const state = document.getElementById("gfState").value.trim();
  const btn = document.getElementById("showTop5Btn");

  if (!apiKey) {
    alert("Please enter API Key.");
    return;
  }
  if (!name) {
    alert("Please enter at least a Property Name.");
    return;
  }

  if (gfAbortController) gfAbortController.abort();
  gfAbortController = new AbortController();

  // Hide Top 5 button while searching
  if (btn) btn.style.display = "none";
  top5Candidates = [];

  resetGfUI();
  updateGfStatus("Fetching Global Asset List (this may take a moment)...");

  const stopBtn = document.getElementById("stopGfBtn");
  if (stopBtn) stopBtn.style.display = "inline-block";

  try {
    const allAssets = await fetchGlobalAssets(apiKey, gfAbortController.signal);

    updateGfProgressBar(100);
    updateGfStatus(`Scanning ${allAssets.length} assets...`);

    await new Promise((r) => setTimeout(r, 100));

    // Calculate score for ALL assets to find Top 5
    const inputObj = { name, address, city, state };

    const scoredAssets = allAssets.map((asset) => {
      const score = calculateGlobalScore(inputObj, asset);
      return { asset, score };
    });

    // Sort by score descending
    scoredAssets.sort((a, b) => b.score - a.score);

    // Save Top 5 for the modal
    top5Candidates = scoredAssets.slice(0, 5);

    // Take the best one for the main table
    const bestMatch = top5Candidates[0];

    // Construct the result object for the main table
    const result = {
      inputName: name,
      inputAddress: address,
      inputCity: city,
      inputState: state,
      score: bestMatch.score.toFixed(3),
      scoreStyle: getGfScoreStyle(bestMatch.score),
      matchedId: bestMatch.asset.id,
      matchedName: bestMatch.asset.name,
      matchedAddress:
        bestMatch.asset.address_line1 ||
        (bestMatch.asset.address ? bestMatch.asset.address.line1 : ""),
      matchedCity:
        bestMatch.asset.address_city ||
        (bestMatch.asset.address ? bestMatch.asset.address.city : ""),
      matchedState:
        bestMatch.asset.address_state ||
        (bestMatch.asset.address ? bestMatch.asset.address.state : ""),
    };

    gfResults = [result];
    renderGfResults(gfResults);

    if (bestMatch.score > 0) {
      updateGfStatus(`Match found: ${result.matchedName}`);
      // Show the button if we have results
      if (btn) btn.style.display = "inline-block";
    } else {
      updateGfStatus("No matches found.");
    }
  } catch (error) {
    if (error.name === "AbortError") {
      updateGfStatus("🛑 Process Stopped.");
    } else {
      console.error(error);
      updateGfStatus(`Error: ${error.message}`);
    }
  } finally {
    if (stopBtn) stopBtn.style.display = "none";
  }
}

function renderTop5Modal() {
  const tbody = document.querySelector("#top5Table tbody");
  tbody.innerHTML = "";

  top5Candidates.forEach((item) => {
    const s = item.score.toFixed(3);
    const style = getGfScoreStyle(item.score);
    const a = item.asset;
    const addr = a.address_line1 || (a.address ? a.address.line1 : "");
    const loc =
      (a.address_city || (a.address ? a.address.city : "")) +
      ", " +
      (a.address_state || (a.address ? a.address.state : ""));

    const row = `
            <tr>
                <td><span style="display:inline-block; padding:4px 8px; border-radius:4px; font-weight:bold; ${style}">${s}</span></td>
                <td style="font-family:monospace; color:var(--accent-light);">${
                  a.id
                }</td>
                <td>${a.name}</td>
                <td>${addr || "-"}</td>
                <td>${loc}</td>
            </tr>
        `;
    tbody.insertAdjacentHTML("beforeend", row);
  });
}

// OPTION B: Bulk Search
async function runBulkGlobalFuzzyMatch() {
  const apiKey = document.getElementById("apiKey").value.trim();
  const fileInput = document.getElementById("gfCsvFile");

  if (!apiKey) {
    alert("Please enter API Key.");
    return;
  }
  if (fileInput.files.length === 0) {
    alert("Please select a CSV.");
    return;
  }

  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = async function (e) {
    const lines = e.target.result.split(/\r?\n/).filter(Boolean);
    if (
      lines[0].toLowerCase().includes("name") ||
      lines[0].toLowerCase().includes("address")
    )
      lines.shift();

    const inputRows = lines.map((line) => {
      // Robust split for CSVs with quotes
      const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
      const clean = (v) => (v ? v.trim().replace(/^"|"$/g, "").trim() : "");

      return {
        name: clean(parts[0]),
        address: clean(parts[1]),
        city: clean(parts[2]),
        state: clean(parts[3]),
      };
    });

    if (inputRows.length === 0) {
      alert("No valid rows.");
      return;
    }

    if (gfAbortController) gfAbortController.abort();
    gfAbortController = new AbortController();

    resetGfUI();
    // Hide single search button in bulk mode
    const btn = document.getElementById("showTop5Btn");
    if (btn) btn.style.display = "none";

    updateGfStatus("Fetching Global Asset List...");

    const stopBtn = document.getElementById("stopGfBtn");
    if (stopBtn) stopBtn.style.display = "inline-block";

    try {
      const allAssets = await fetchGlobalAssets(
        apiKey,
        gfAbortController.signal,
      );
      updateGfProgressBar(0); // Reset progress bar for the matching phase
      await new Promise((r) => setTimeout(r, 100));

      updateGfStatus(`Processing ${inputRows.length} rows...`);

      let matches = [];
      const BATCH_SIZE = 50; // Process in chunks to prevent browser freeze

      for (let i = 0; i < inputRows.length; i += BATCH_SIZE) {
        if (gfAbortController.signal.aborted)
          throw new DOMException("Aborted", "AbortError");

        const batch = inputRows.slice(i, i + BATCH_SIZE);

        for (const row of batch) {
          let best = { score: 0, asset: null };
          let candidates = allAssets;

          // OPTIMIZATION: Filter global assets by State first to drastically reduce comparisons
          if (row.state) {
            const rowStateNorm = normalizeGfState(row.state);
            const stateFiltered = allAssets.filter((a) => {
              const aState =
                a.address_state || (a.address ? a.address.state : "");
              return normalizeGfState(aState) === rowStateNorm;
            });
            if (stateFiltered.length > 0) candidates = stateFiltered;
          }

          // Run fuzzy match only on the narrowed-down candidates
          for (let asset of candidates) {
            const score = calculateGlobalScore(row, asset);
            if (score > best.score) best = { score, asset };
          }

          let mId = "",
            mName = "",
            mAddr = "",
            mCity = "",
            mState = "";
          if (best.asset) {
            mId = best.asset.id;
            mName = best.asset.name;
            mAddr =
              best.asset.address_line1 ||
              (best.asset.address ? best.asset.address.line1 : "");
            mCity =
              best.asset.address_city ||
              (best.asset.address ? best.asset.address.city : "");
            mState =
              best.asset.address_state ||
              (best.asset.address ? best.asset.address.state : "");
          }

          matches.push({
            inputName: row.name,
            inputAddress: row.address,
            inputCity: row.city,
            inputState: row.state,
            score: best.score.toFixed(3),
            scoreStyle: getGfScoreStyle(best.score),
            matchedId: mId,
            matchedName: mName,
            matchedAddress: mAddr,
            matchedCity: mCity,
            matchedState: mState,
          });
        }

        // Update UI Progress for the matching phase
        const percentDone = Math.floor(
          ((i + batch.length) / inputRows.length) * 100,
        );
        updateGfProgressBar(percentDone);
        updateGfStatus(
          `Matched ${Math.min(i + batch.length, inputRows.length)} of ${inputRows.length} rows...`,
        );

        // Yield to the main thread so the browser can paint the progress bar
        await new Promise((r) => setTimeout(r, 0));
      }

      // Sort by best matches first
      matches.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));

      gfResults = matches;
      renderGfResults(matches);
      updateGfProgressBar(100);
      updateGfStatus(`Bulk Complete. Processed ${matches.length} rows.`);
    } catch (error) {
      if (error.name === "AbortError") {
        updateGfStatus("🛑 Bulk Process Stopped.");
      } else {
        console.error(error);
        updateGfStatus(`Error: ${error.message}`);
      }
    } finally {
      if (stopBtn) stopBtn.style.display = "none";
    }
  };
  reader.readAsText(file);
}

async function fetchGlobalAssets(apiKey, signal) {
  let allAssets = [];
  let nextUrl = `https://api.sightmap.com/v1/assets?per-page=500`;
  let totalCount = 0;

  while (nextUrl) {
    if (signal && signal.aborted)
      throw new DOMException("Aborted", "AbortError");

    const response = await fetch(nextUrl, {
      method: "GET",
      headers: { "API-Key": apiKey },
      signal: signal,
    });
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const json = await response.json();
    allAssets = allAssets.concat(json.data || []);

    if (json.paging && json.paging.total_count)
      totalCount = json.paging.total_count;
    nextUrl = json.paging ? json.paging.next_url : null;

    let pct = totalCount
      ? Math.floor((allAssets.length / totalCount) * 100)
      : nextUrl
        ? 50
        : 100;
    updateGfProgressBar(pct);
    updateGfStatus(
      `Fetching global DB... ${allAssets.length} / ${totalCount || "?"}`,
    );
    await new Promise((r) => setTimeout(r, 0));
  }
  return allAssets;
}

// ==========================================
// SCORING LOGIC (UPDATED WITH SMART NORMALIZATION)
// ==========================================

function calculateGlobalScore(input, asset) {
  // Use Smart Normalizers
  const iName = normalizeGfString(input.name);
  const iAddr = normalizeGfAddress(input.address);
  const iCity = normalizeGfString(input.city);
  const iState = normalizeGfState(input.state);

  const aName = normalizeGfString(asset.name);
  const aAddr = normalizeGfAddress(
    asset.address_line1 || (asset.address ? asset.address.line1 : ""),
  );
  const aCity = normalizeGfString(
    asset.address_city || (asset.address ? asset.address.city : ""),
  );
  const aState = normalizeGfState(
    asset.address_state || (asset.address ? asset.address.state : ""),
  );

  // 1. Name Score (50% Weight)
  const nameScore = combinedScoreGf(iName, aName);

  // 2. Address Score (30% Weight)
  let addrScore = 0;
  if (iAddr && aAddr) {
    // Perfect match or containment
    if (iAddr === aAddr) addrScore = 1.0;
    else if (iAddr.includes(aAddr) || aAddr.includes(iAddr)) addrScore = 0.95;
    else {
      const sim = similarityGf(iAddr, aAddr);
      // Boost if street numbers match perfectly
      const iNum = iAddr.match(/^\d+/);
      const aNum = aAddr.match(/^\d+/);
      if (iNum && aNum && iNum[0] === aNum[0]) {
        addrScore = Math.max(sim, 0.7);
      } else {
        addrScore = sim;
      }
    }
  } else if (!iAddr) {
    addrScore = 1; // Ignore if input missing
  }

  // 3. City Score (15% Weight)
  let cityScore = 0;
  if (iCity && aCity) {
    if (iCity === aCity) cityScore = 1.0;
    else if (iCity.includes(aCity) || aCity.includes(iCity)) cityScore = 0.9;
    else cityScore = similarityGf(iCity, aCity);
  } else if (!iCity) {
    cityScore = 1;
  }

  // 4. State Score (5% Weight)
  // Smart Normalization makes this robust (CA == California)
  let stateScore = 0;
  if (iState && aState) stateScore = iState === aState ? 1 : 0;
  else if (!iState) stateScore = 1;

  // Calculate Weighted Total
  let total =
    nameScore * 0.5 + addrScore * 0.3 + cityScore * 0.15 + stateScore * 0.05;
  return total;
}

// ==========================================
// HELPER FUNCTIONS (Normalization & Utils)
// ==========================================

function normalizeGfString(str) {
  if (!str) return "";
  return str
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,'’"#-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeGfAddress(str) {
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

const GF_STATE_MAP = {
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

function normalizeGfState(str) {
  if (!str) return "";
  const clean = str.toLowerCase().trim().replace(/\./g, "");
  if (clean.length === 2) return clean; // Already a code
  return GF_STATE_MAP[clean] || clean; // Convert or return original
}

function levenshteinGf(a, b) {
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
function similarityGf(a, b) {
  if (!a || !b) return 0;
  return 1 - levenshteinGf(a, b) / Math.max(a.length, b.length);
}
function tokenMatchScoreGf(a, b) {
  const t1 = new Set(normalizeGfString(a).split(" "));
  const t2 = new Set(normalizeGfString(b).split(" "));
  const inter = [...t1].filter((t) => t2.has(t));
  return inter.length / Math.max(t1.size, 1);
}
function combinedScoreGf(a, b) {
  return similarityGf(a, b) * 0.6 + tokenMatchScoreGf(a, b) * 0.4;
}
function getGfScoreStyle(score) {
  const s = parseFloat(score);
  if (s >= 0.9) return "background-color:#22c55e;color:white;";
  if (s >= 0.8) return "background-color:#eab308;color:black;";
  if (s >= 0.6) return "background-color:#f97316;color:white;";
  return "background-color:#52525b;color:white;";
}

function renderGfResults(matches) {
  const tbody = document.querySelector("#gfTable tbody");
  tbody.innerHTML = "";
  document.getElementById("gfCount").textContent = matches.length;
  matches.forEach((m) => {
    const row = `<tr>
            <td><span style="display:inline-block; padding:4px 8px; border-radius:4px; font-weight:bold; ${m.scoreStyle}">${m.score}</span></td>
            <td>${m.inputName}</td>
            <td>${m.inputAddress}</td>
            <td>${m.inputCity}</td>
            <td>${m.inputState}</td>
            <td style="font-family:monospace; color:var(--accent-light);">${m.matchedId}</td>
            <td>${m.matchedName}</td>
            <td>${m.matchedAddress}</td>
            <td>${m.matchedCity}</td>
            <td>${m.matchedState}</td>
        </tr>`;
    tbody.insertAdjacentHTML("beforeend", row);
  });
}

function resetGfUI() {
  gfResults = [];
  document.querySelector("#gfTable tbody").innerHTML = "";
  updateGfProgressBar(0);
  document.getElementById("gfCount").textContent = "0";
}
function updateGfStatus(msg) {
  document.getElementById("gfStatusMsg").textContent = msg;
}
function updateGfProgressBar(pct) {
  const bar = document.getElementById("gfProgressBar");
  if (bar) bar.style.width = pct + "%";
}

function downloadGfCSV() {
  if (gfResults.length === 0) {
    alert("No data");
    return;
  }
  let csv =
    "Score,InputName,InputAddress,InputCity,InputState,MatchedID,MatchedName,MatchedAddress,MatchedCity,MatchedState\n";
  gfResults.forEach((r) => {
    csv += `${r.score},"${r.inputName}","${r.inputAddress}","${r.inputCity}","${r.inputState}",${r.matchedId},"${r.matchedName}","${r.matchedAddress}","${r.matchedCity}","${r.matchedState}"\n`;
  });
  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "global_fuzzy_results.csv";
  link.click();
}
function copyGfTable() {
  if (gfResults.length === 0) {
    alert("No data");
    return;
  }
  let text = "Score\tInputName\tInputAddr\tMatchID\tMatchName\tMatchAddr\n";
  gfResults.forEach((r) => {
    text += `${r.score}\t${r.inputName}\t${r.inputAddress}\t${r.matchedId}\t${r.matchedName}\t${r.matchedAddress}\n`;
  });
  navigator.clipboard.writeText(text);
  alert("Copied");
}
