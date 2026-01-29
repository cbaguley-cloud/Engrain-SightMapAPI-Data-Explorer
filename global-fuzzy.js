/* global-fuzzy.js 
   Handles Global Fuzzy Matching (Name + Address against entire database).
*/

let gfResults = [];
let top5Candidates = []; // Stores the top 5 for the modal

document.addEventListener("DOMContentLoaded", () => {
  // Option A: Single
  document
    .getElementById("runGlobalFuzzyBtn")
    .addEventListener("click", runGlobalFuzzyMatch);

  // Option B: Bulk
  document
    .getElementById("bulkGlobalFuzzyBtn")
    .addEventListener("click", runBulkGlobalFuzzyMatch);

  // Utils
  document
    .getElementById("downloadGfBtn")
    .addEventListener("click", downloadGfCSV);
  document
    .getElementById("copyGfClipBtn")
    .addEventListener("click", copyGfTable);

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
  document.getElementById("gfTemplateLink").addEventListener("click", (e) => {
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

  // Hide Top 5 button while searching
  if (btn) btn.style.display = "none";
  top5Candidates = [];

  resetGfUI();
  updateGfStatus("Fetching Global Asset List (this may take a moment)...");

  try {
    const allAssets = await fetchGlobalAssets(apiKey);

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
    console.error(error);
    updateGfStatus(`Error: ${error.message}`);
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
      const parts = line.split(",");
      return {
        name: parts[0]?.trim() || "",
        address: parts[1]?.trim() || "",
        city: parts[2]?.trim() || "",
        state: parts[3]?.trim() || "",
      };
    });

    if (inputRows.length === 0) {
      alert("No valid rows.");
      return;
    }

    resetGfUI();
    // Hide single search button in bulk mode
    const btn = document.getElementById("showTop5Btn");
    if (btn) btn.style.display = "none";

    updateGfStatus("Fetching Global Asset List...");

    try {
      const allAssets = await fetchGlobalAssets(apiKey);
      updateGfProgressBar(100);
      await new Promise((r) => setTimeout(r, 100));

      updateGfStatus(`Processing ${inputRows.length} rows...`);

      const matches = inputRows.map((row) => {
        let best = { score: 0, asset: null };

        // Optimization: Logic identical to single, but loop kept for bulk speed
        for (let asset of allAssets) {
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

        return {
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
        };
      });

      // Sort by best matches first
      matches.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));

      gfResults = matches;
      renderGfResults(matches);
      updateGfStatus(`Bulk Complete. Processed ${matches.length} rows.`);
    } catch (error) {
      console.error(error);
      updateGfStatus(`Error: ${error.message}`);
    }
  };
  reader.readAsText(file);
}

async function fetchGlobalAssets(apiKey) {
  let allAssets = [];
  let nextUrl = `https://api.sightmap.com/v1/assets?per-page=500`;
  let totalCount = 0;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      method: "GET",
      headers: { "API-Key": apiKey },
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
      `Fetching global DB... ${allAssets.length} / ${totalCount || "?"}`
    );
    await new Promise((r) => setTimeout(r, 0));
  }
  return allAssets;
}

function calculateGlobalScore(input, asset) {
  const iName = normalizeGf(input.name);
  const iAddr = normalizeGf(input.address);
  const iCity = normalizeGf(input.city);
  const iState = normalizeGf(input.state);

  const aName = normalizeGf(asset.name);
  const aAddr = normalizeGf(asset.address ? asset.address.line1 : "");
  const aCity = normalizeGf(
    asset.address_city || (asset.address ? asset.address.city : "")
  );
  const aState = normalizeGf(
    asset.address_state || (asset.address ? asset.address.state : "")
  );

  // Scoring Weights
  // Name: 50%, Address: 30%, City: 15%, State: 5%
  const nameScore = combinedScoreGf(iName, aName);

  let addrScore = 0;
  if (iAddr && aAddr) addrScore = similarityGf(iAddr, aAddr);
  else if (!iAddr) addrScore = 1; // Ignore if input missing

  let cityScore = 0;
  if (iCity && aCity) cityScore = similarityGf(iCity, aCity);
  else if (!iCity) cityScore = 1;

  let stateScore = 0;
  if (iState && aState) stateScore = iState === aState ? 1 : 0;
  else if (!iState) stateScore = 1;

  // Adjust weights based on what was provided
  let total =
    nameScore * 0.5 + addrScore * 0.3 + cityScore * 0.15 + stateScore * 0.05;
  return total;
}

// --- Helpers ---
function normalizeGf(str) {
  if (!str) return "";
  return str
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,'’"]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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
  const t1 = new Set(normalizeGf(a).split(" "));
  const t2 = new Set(normalizeGf(b).split(" "));
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
