/* unitmap-search.js */

let allMatches = [];
let mapAbortController = null; // Added AbortController

document.addEventListener("DOMContentLoaded", () => {
  // Buttons
  const fetchBtn = document.getElementById("fetchBtn");
  if (fetchBtn) fetchBtn.addEventListener("click", runSingleSearch);
  const bulkBtn = document.getElementById("bulkBtn");
  if (bulkBtn) bulkBtn.addEventListener("click", runBulkSearch);
  const copyBtn = document.getElementById("copyBtn");
  if (copyBtn) copyBtn.addEventListener("click", exportJSON);
  const downloadBtn = document.getElementById("downloadBtn");
  if (downloadBtn) downloadBtn.addEventListener("click", downloadCSV);
  const copyClipBtn = document.getElementById("copyMapClipBtn");
  if (copyClipBtn) copyClipBtn.addEventListener("click", copyMapTable);

  // LOCAL STOP BUTTON
  const stopBtn = document.getElementById("stopMapBtn");
  if (stopBtn) {
    stopBtn.addEventListener("click", () => {
      if (mapAbortController) mapAbortController.abort();
      stopBtn.style.display = "none";
    });
  }

  // GLOBAL KILL SWITCH LISTENER
  window.addEventListener("killAllProcesses", () => {
    if (mapAbortController) {
      mapAbortController.abort();
      const localStopBtn = document.getElementById("stopMapBtn");
      if (localStopBtn) localStopBtn.style.display = "none";
      updateStatus("🛑 Process globally terminated.");
    }
  });

  // Template Download
  const templateLink = document.getElementById("mapTemplateLink");
  if (templateLink) {
    templateLink.addEventListener("click", (e) => {
      e.preventDefault();
      const csvContent = "asset_id";
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", "map_search_template.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }

  // Select All
  const selectAllCheckbox = document.getElementById("selectAllStyles");
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener("change", function () {
      const checkboxes = document.querySelectorAll('input[name="style"]');
      checkboxes.forEach((cb) => (cb.checked = this.checked));
    });
  }
});

function getSelectedStyles() {
  const checkboxes = document.querySelectorAll('input[name="style"]:checked');
  return Array.from(checkboxes).map((cb) => cb.value.toLowerCase());
}

async function runSingleSearch() {
  const apiKey = document.getElementById("apiKey").value.trim();
  const assetId = document.getElementById("assetId").value.trim();
  const targetStyles = getSelectedStyles();

  if (!apiKey || !assetId) {
    alert("Please enter API Key and Asset ID");
    return;
  }
  if (targetStyles.length === 0) {
    alert("Please select at least one Map Style.");
    return;
  }

  if (mapAbortController) mapAbortController.abort();
  mapAbortController = new AbortController();

  resetUI();
  updateStatus(`Fetching maps for Asset ${assetId}...`);

  const stopBtn = document.getElementById("stopMapBtn");
  if (stopBtn) stopBtn.style.display = "inline-block";

  try {
    // VISUAL: Set to 50% while loading
    document.getElementById("progressBar").style.width = "50%";

    await fetchAndProcessAsset(
      apiKey,
      assetId,
      targetStyles,
      mapAbortController.signal,
    );

    // VISUAL: Set to 100% when done
    document.getElementById("progressBar").style.width = "100%";

    if (allMatches.length > 0) {
      updateStatus(`Done. Found ${allMatches.length} matches.`);
    } else {
      updateStatus(`No matches found for styles: ${targetStyles.join(", ")}`);
    }
    document.getElementById("mapCount").textContent = allMatches.length;
  } catch (error) {
    if (error.name === "AbortError") {
      updateStatus("🛑 Process Stopped.");
    } else {
      console.error(error);
      updateStatus(`Error: ${error.message}`);
    }
  } finally {
    if (stopBtn) stopBtn.style.display = "none";
  }
}

async function runBulkSearch() {
  const apiKey = document.getElementById("apiKey").value.trim();
  const fileInput = document.getElementById("csvFile");
  const targetStyles = getSelectedStyles();

  if (!apiKey) {
    alert("Please enter API Key");
    return;
  }
  if (targetStyles.length === 0) {
    alert("Please select at least one Map Style.");
    return;
  }
  if (!fileInput || fileInput.files.length === 0) {
    alert("Please select a CSV file");
    return;
  }

  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = async function (e) {
    const text = e.target.result;
    const assetIds = parseCSV(text);

    if (assetIds.length === 0) {
      alert("No Asset IDs found. Check CSV format.");
      return;
    }

    if (mapAbortController) mapAbortController.abort();
    mapAbortController = new AbortController();

    resetUI();
    updateStatus(`Found ${assetIds.length} assets. Starting bulk process...`);

    const stopBtn = document.getElementById("stopMapBtn");
    if (stopBtn) stopBtn.style.display = "inline-block";

    try {
      let processed = 0;
      for (const id of assetIds) {
        if (mapAbortController.signal.aborted)
          throw new DOMException("Aborted", "AbortError");

        updateStatus(
          `Processing Asset ${id} (${processed + 1}/${assetIds.length})...`,
        );

        await fetchAndProcessAsset(
          apiKey,
          id,
          targetStyles,
          mapAbortController.signal,
        );

        processed++;
        // VISUAL: Update based on percentage
        document.getElementById("progressBar").style.width =
          `${(processed / assetIds.length) * 100}%`;
        document.getElementById("mapCount").textContent = allMatches.length;

        // Allow UI update
        await new Promise((r) => setTimeout(r, 0));
      }

      updateStatus(
        `Bulk Process Complete. Found ${allMatches.length} total matches.`,
      );
    } catch (error) {
      if (error.name === "AbortError") {
        updateStatus("🛑 Bulk Process Stopped.");
      } else {
        console.error(error);
        updateStatus(`Error: ${error.message}`);
      }
    } finally {
      if (stopBtn) stopBtn.style.display = "none";
    }
  };

  reader.readAsText(file);
}

// Added `signal` parameter
async function fetchAndProcessAsset(apiKey, assetId, targetStyles, signal) {
  try {
    const response = await fetch(
      `https://api.sightmap.com/v1/assets/${assetId}/multifamily/maps?page=1&per-page=500`,
      {
        method: "GET",
        headers: { "API-Key": apiKey },
        signal: signal, // Attach the abort signal to the fetch request
      },
    );

    if (!response.ok) {
      console.warn(`Asset ${assetId} failed: ${response.status}`);
      return;
    }

    const jsonData = await response.json();
    const mapData = jsonData.data || [];

    mapData.forEach((map) => {
      if (map.style && targetStyles.includes(map.style.toLowerCase())) {
        const matchObj = {
          asset_id: assetId,
          id: map.id,
          name: map.name,
          style: map.style,
          tags: map.tags,
        };
        allMatches.push(matchObj);
        addTableRow(matchObj);
      }
    });
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error(`Error processing asset ${assetId}:`, error);
    } else {
      throw error; // Bubble up the abort error to stop the loop
    }
  }
}

function parseCSV(csvText) {
  const lines = csvText.split(/\r\n|\n/);
  const ids = [];
  let idIndex = 0;
  const headers = lines[0].toLowerCase().split(",");
  const foundIndex = headers.findIndex(
    (h) => h.trim().includes("asset_id") || h.trim().includes("assetid"),
  );
  if (foundIndex !== -1) idIndex = foundIndex;
  const startRow = foundIndex !== -1 ? 1 : 0;
  for (let i = startRow; i < lines.length; i++) {
    const row = lines[i].split(",");
    if (row.length > idIndex) {
      const val = row[idIndex].trim();
      if (val && !isNaN(val)) ids.push(val);
    }
  }
  return ids;
}

function addTableRow(map) {
  const tableBody = document.querySelector("#resultsTable tbody");
  if (!tableBody) return;
  const row = `<tr>
            <td>${map.asset_id}</td>
            <td>${map.name}</td>
            <td>${map.id}</td>
            <td>${map.tags}</td>
            <td><span class="match-tag">${map.style}</span></td>
        </tr>`;
  tableBody.insertAdjacentHTML("beforeend", row);
}

function resetUI() {
  allMatches = [];
  const tbody = document.querySelector("#resultsTable tbody");
  if (tbody) tbody.innerHTML = "";

  document.getElementById("progressBar").style.width = "0%";
  document.getElementById("mapCount").textContent = "0";
}

function updateStatus(msg) {
  const statusDiv = document.getElementById("statusMsg");
  if (statusDiv) statusDiv.textContent = msg;
}

function exportJSON() {
  if (allMatches.length === 0) {
    alert("No data");
    return;
  }
  navigator.clipboard.writeText(JSON.stringify(allMatches, null, 2));
  alert("Copied JSON");
}

function downloadCSV() {
  if (allMatches.length === 0) {
    alert("No data");
    return;
  }
  let csvContent = "asset_id,map_name,map_id,tags,style\n";
  allMatches.forEach((row) => {
    csvContent += `${row.asset_id},"${row.name}",${row.id},${row.tags},${row.style}\n`;
  });
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", "sightmap_matches.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function copyMapTable() {
  if (allMatches.length === 0) {
    alert("No data");
    return;
  }
  let text = "Asset ID\tMap Name\tMap ID\tTags\tStyle\n";
  allMatches.forEach((r) => {
    text += `${r.asset_id}\t${r.name}\t${r.id}\t${r.tags}\t${r.style}\n`;
  });
  navigator.clipboard.writeText(text);
  alert("Table copied to clipboard!");
}
