/* asset-references.js */

let allReferences = [];
let assetRefAbortController = null; // Added AbortController

document.addEventListener("DOMContentLoaded", () => {
  // Buttons
  document
    .getElementById("fetchRefBtn")
    .addEventListener("click", runSingleRefSearch);
  document
    .getElementById("bulkRefBtn")
    .addEventListener("click", runBulkRefSearch);
  document
    .getElementById("copyRefJsonBtn")
    .addEventListener("click", exportRefJSON);
  document
    .getElementById("downloadRefCsvBtn")
    .addEventListener("click", downloadRefCSV);

  // Copy to Clipboard Button
  const copyClipBtn = document.getElementById("copyRefClipBtn");
  if (copyClipBtn) copyClipBtn.addEventListener("click", copyRefTable);

  // LOCAL STOP BUTTON
  const stopBtn = document.getElementById("stopRefBtn");
  if (stopBtn) {
    stopBtn.addEventListener("click", () => {
      if (assetRefAbortController) assetRefAbortController.abort();
      stopBtn.style.display = "none";
    });
  }

  // GLOBAL KILL SWITCH LISTENER
  window.addEventListener("killAllProcesses", () => {
    if (assetRefAbortController) {
      assetRefAbortController.abort();
      const localStopBtn = document.getElementById("stopRefBtn");
      if (localStopBtn) localStopBtn.style.display = "none";
      updateAssetRefStatus("🛑 Process globally terminated.");
    }
  });

  // Template
  document.getElementById("refTemplateLink").addEventListener("click", (e) => {
    e.preventDefault();
    const csvContent = "asset_id";
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "references_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
});

async function runSingleRefSearch() {
  const apiKey = document.getElementById("apiKey").value.trim();
  const assetId = document.getElementById("refAssetId").value.trim();
  if (!apiKey || !assetId) {
    alert("Please enter API Key and Asset ID");
    return;
  }

  if (assetRefAbortController) assetRefAbortController.abort();
  assetRefAbortController = new AbortController();

  resetRefUI();
  updateAssetRefStatus(`Fetching references for Asset ${assetId}...`);

  const stopBtn = document.getElementById("stopRefBtn");
  if (stopBtn) stopBtn.style.display = "inline-block";

  try {
    document.getElementById("refProgressBar").style.width = `50%`;
    await fetchAndProcessReferences(
      apiKey,
      assetId,
      assetRefAbortController.signal,
    );
    document.getElementById("refProgressBar").style.width = `100%`;

    if (allReferences.length > 0) {
      updateAssetRefStatus(`Done. Found ${allReferences.length} references.`);
    } else {
      updateAssetRefStatus(`⚠️ No references found for Asset ${assetId}.`);
    }
    document.getElementById("refCount").textContent = allReferences.length;
  } catch (error) {
    if (error.name === "AbortError") {
      updateAssetRefStatus("🛑 Process Stopped.");
    } else {
      console.error(error);
      updateAssetRefStatus(`Error: ${error.message}`);
    }
  } finally {
    if (stopBtn) stopBtn.style.display = "none";
  }
}

async function runBulkRefSearch() {
  const apiKey = document.getElementById("apiKey").value.trim();
  const fileInput = document.getElementById("refCsvFile");
  if (!apiKey) {
    alert("Please enter API Key");
    return;
  }
  if (fileInput.files.length === 0) {
    alert("Please select a CSV file");
    return;
  }
  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = async function (e) {
    const text = e.target.result;
    const assetIds = parseRefCSV(text);
    if (assetIds.length === 0) {
      alert("No Asset IDs found. Check CSV format.");
      return;
    }

    if (assetRefAbortController) assetRefAbortController.abort();
    assetRefAbortController = new AbortController();

    resetRefUI();
    updateAssetRefStatus(
      `Found ${assetIds.length} assets. Starting bulk process...`,
    );

    const stopBtn = document.getElementById("stopRefBtn");
    if (stopBtn) stopBtn.style.display = "inline-block";

    try {
      let processed = 0;
      for (const id of assetIds) {
        if (assetRefAbortController.signal.aborted)
          throw new DOMException("Aborted", "AbortError");

        updateAssetRefStatus(
          `Processing Asset ${id} (${processed + 1}/${assetIds.length})...`,
        );

        await fetchAndProcessReferences(
          apiKey,
          id,
          assetRefAbortController.signal,
        );

        processed++;
        document.getElementById("refProgressBar").style.width =
          `${(processed / assetIds.length) * 100}%`;
        document.getElementById("refCount").textContent = allReferences.length;

        await new Promise((r) => setTimeout(r, 0));
      }

      updateAssetRefStatus(
        `Bulk Process Complete. Found ${allReferences.length} total references.`,
      );
    } catch (error) {
      if (error.name === "AbortError") {
        updateAssetRefStatus("🛑 Bulk Process Stopped.");
      } else {
        console.error(error);
        updateAssetRefStatus(`Error: ${error.message}`);
      }
    } finally {
      if (stopBtn) stopBtn.style.display = "none";
    }
  };
  reader.readAsText(file);
}

async function fetchAndProcessReferences(apiKey, assetId, signal) {
  let nextUrl = `https://api.sightmap.com/v1/assets/${assetId}/multifamily/references?per-page=100`;
  try {
    while (nextUrl) {
      if (signal && signal.aborted)
        throw new DOMException("Aborted", "AbortError");

      const response = await fetch(nextUrl, {
        method: "GET",
        headers: { "API-Key": apiKey, "Experimental-Flags": "references" },
        signal: signal,
      });

      if (!response.ok) {
        if (response.status !== 404)
          console.error(`Asset ${assetId} error: ${response.status}`);
        return;
      }

      const jsonData = await response.json();
      const refData = jsonData.data || [];

      refData.forEach((ref) => {
        const matchObj = {
          asset_id: assetId,
          id: ref.id,
          name: ref.name,
          key: ref.key,
          value: ref.value,
        };
        allReferences.push(matchObj);
        addRefTableRow(matchObj);
      });

      nextUrl = jsonData.paging ? jsonData.paging.next_url : null;
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error(`Error processing asset ${assetId}:`, error);
    } else {
      throw error;
    }
  }
}

function parseRefCSV(csvText) {
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

function addRefTableRow(ref) {
  const tableBody = document.querySelector("#refTable tbody");
  const row = `<tr><td>${ref.asset_id}</td><td style="font-family:monospace; color:var(--accent-light);">${ref.id}</td><td>${ref.name}</td><td><span class="match-tag" style="background:#27272a; color:#fff; border:1px solid #444;">${ref.key}</span></td><td style="font-family:monospace; font-size:0.9em;">${ref.value}</td></tr>`;
  tableBody.insertAdjacentHTML("beforeend", row);
}

function resetRefUI() {
  allReferences = [];
  document.querySelector("#refTable tbody").innerHTML = "";
  document.getElementById("refProgressBar").style.width = "0%";
  document.getElementById("refCount").textContent = "0";
}

function updateAssetRefStatus(msg) {
  document.getElementById("refStatusMsg").textContent = msg;
}

function exportRefJSON() {
  if (allReferences.length === 0) {
    alert("No data");
    return;
  }
  navigator.clipboard.writeText(JSON.stringify(allReferences, null, 2));
  alert("Copied JSON");
}

function downloadRefCSV() {
  if (allReferences.length === 0) {
    alert("No data");
    return;
  }
  let csvContent = "asset_id,reference_id,name,key,value\n";
  allReferences.forEach((row) => {
    const cleanName = row.name ? row.name.replace(/"/g, '""') : "";
    const cleanValue = row.value ? row.value.replace(/"/g, '""') : "";
    csvContent += `${row.asset_id},${row.id},"${cleanName}",${row.key},"${cleanValue}"\n`;
  });
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", "sightmap_references.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Copy Table to Clipboard
function copyRefTable() {
  if (allReferences.length === 0) {
    alert("No data");
    return;
  }

  let text = "Asset ID\tRef ID\tName\tKey\tValue\n";
  allReferences.forEach((r) => {
    text += `${r.asset_id}\t${r.id}\t${r.name}\t${r.key}\t${r.value}\n`;
  });

  navigator.clipboard.writeText(text);
  alert("Table copied to clipboard!");
}
