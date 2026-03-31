/* embed-matcher.js */

// GLOBAL HASH INDEX
let globalEmbedIndex = new Map();
let isIndexBuilt = false;
const CACHE_KEY = "engrain_embed_data_v1";
let embedAbortController = null; // Added AbortController

document.addEventListener("DOMContentLoaded", () => {
  const embedBtn = document.getElementById("findEmbedBtn");
  const resetBtn = document.getElementById("resetCacheBtn");

  if (embedBtn) embedBtn.addEventListener("click", runEmbedSearch);
  if (resetBtn) resetBtn.addEventListener("click", forceReIndex);

  // LOCAL STOP BUTTON
  const stopBtn = document.getElementById("stopEmbedBtn");
  if (stopBtn) {
    stopBtn.addEventListener("click", () => {
      if (embedAbortController) embedAbortController.abort();
      stopBtn.style.display = "none";
    });
  }

  // GLOBAL KILL SWITCH LISTENER
  window.addEventListener("killAllProcesses", () => {
    if (embedAbortController) {
      embedAbortController.abort();
      const localStopBtn = document.getElementById("stopEmbedBtn");
      if (localStopBtn) localStopBtn.style.display = "none";
      const statusDiv = document.getElementById("embedStatus");
      if (statusDiv) statusDiv.textContent = "🛑 Process globally terminated.";
    }
  });

  // 1. Try to load cache immediately on page load
  loadIndexFromDisk();
});

// ==========================================
// MAIN FUNCTION
// ==========================================
async function runEmbedSearch() {
  const apiKey = document.getElementById("apiKey").value.trim();
  let targetUrl = document.getElementById("embedUrlInput").value.trim();
  const statusDiv = document.getElementById("embedStatus");
  const resultDiv = document.getElementById("embedResultContainer");

  if (!apiKey) {
    alert("Please enter API Key.");
    return;
  }
  if (!targetUrl) {
    alert("Please enter an Embed URL.");
    return;
  }

  // Normalize Input URL (remove trailing slash for better matching)
  targetUrl = normalizeUrl(targetUrl);

  // 2. FAST PATH: Check Cache (Memory or Disk)
  if (isIndexBuilt) {
    console.log("Checking Index...");
    const cachedMatch = globalEmbedIndex.get(targetUrl);

    if (cachedMatch) {
      statusDiv.textContent = "Match found in Cache!";
      displayEmbedResult(cachedMatch);
    } else {
      statusDiv.textContent =
        "URL not found in cached index. Try 'Force Re-Index' if this is a newly added unit.";
      resultDiv.style.display = "none";
    }
    return;
  }

  // 3. SLOW PATH: Build Index from API
  if (embedAbortController) embedAbortController.abort();
  embedAbortController = new AbortController();

  resultDiv.style.display = "none";
  statusDiv.textContent = "Initializing Index Build...";

  const stopBtn = document.getElementById("stopEmbedBtn");
  if (stopBtn) stopBtn.style.display = "inline-block";

  try {
    const accounts = await fetchAllAccounts(
      apiKey,
      statusDiv,
      embedAbortController.signal,
    );

    if (accounts.length === 0) {
      statusDiv.textContent = "No accounts found.";
      return;
    }

    statusDiv.textContent = `Building Index: Scanning ${accounts.length} accounts...`;

    // Process in batches (Concurrency)
    const BATCH_SIZE = 20;
    let processedCount = 0;

    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
      if (embedAbortController.signal.aborted)
        throw new DOMException("Aborted", "AbortError");

      const batch = accounts.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map((acc) =>
        fetchAndIndexAccount(apiKey, acc, embedAbortController.signal),
      );
      await Promise.all(batchPromises);

      processedCount += batch.length;

      // Update UI
      const percent = Math.round((processedCount / accounts.length) * 100);
      statusDiv.textContent = `Indexing: ${percent}% complete (${processedCount}/${accounts.length} accounts)...`;

      // Optional: Early display if found
      if (
        globalEmbedIndex.has(targetUrl) &&
        resultDiv.style.display === "none"
      ) {
        displayEmbedResult(globalEmbedIndex.get(targetUrl));
        statusDiv.textContent = `Match Found! Finishing index build...`;
      }
    }

    // Mark index as built regardless of storage success
    isIndexBuilt = true;

    // 4. Attempt Save to Disk
    saveIndexToDisk();

    // Final check
    const match = globalEmbedIndex.get(targetUrl);
    if (match) {
      statusDiv.textContent = "Index Complete. Match Found!";
      displayEmbedResult(match);
    } else {
      statusDiv.textContent = `Index Complete. Scanned ${globalEmbedIndex.size} embeds, but URL not found.`;
    }
  } catch (error) {
    if (error.name === "AbortError") {
      statusDiv.textContent = "🛑 Process Stopped.";
    } else {
      console.error(error);
      statusDiv.textContent = `Error: ${error.message}`;
    }
  } finally {
    if (stopBtn) stopBtn.style.display = "none";
  }
}

// ==========================================
// HELPERS
// ==========================================

function normalizeUrl(url) {
  if (!url) return "";
  return url.replace(/\/$/, ""); // Remove trailing slash if present
}

function saveIndexToDisk() {
  try {
    // Check size estimation before stringifying to avoid crash
    if (globalEmbedIndex.size > 5000) {
      throw new Error("Index too large for Local Storage");
    }
    const serializedData = JSON.stringify(
      Array.from(globalEmbedIndex.entries()),
    );
    localStorage.setItem(CACHE_KEY, serializedData);
    console.log(`Saved ${globalEmbedIndex.size} embeds to Local Storage.`);
    updateCacheStatusUI();
  } catch (e) {
    console.warn("Storage warning:", e);
    const statusSpan = document.getElementById("cacheStatusText");
    if (statusSpan) {
      statusSpan.textContent = `Memory Only (Index too large for disk: ${globalEmbedIndex.size} items)`;
      statusSpan.style.color = "#f59e0b";
    }
  }
}

function loadIndexFromDisk() {
  const raw = localStorage.getItem(CACHE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      globalEmbedIndex = new Map(parsed);
      isIndexBuilt = true;
      updateCacheStatusUI();
      console.log(`Loaded ${globalEmbedIndex.size} embeds from cache.`);
    } catch (e) {
      console.error("Corrupt cache data", e);
      localStorage.removeItem(CACHE_KEY);
    }
  } else {
    updateCacheStatusUI();
  }
}

function forceReIndex() {
  localStorage.removeItem(CACHE_KEY);
  globalEmbedIndex.clear();
  isIndexBuilt = false;
  updateCacheStatusUI();
  document.getElementById("embedStatus").textContent =
    "Cache cleared. Ready to re-scan.";
  document.getElementById("embedResultContainer").style.display = "none";
}

function updateCacheStatusUI() {
  const statusSpan = document.getElementById("cacheStatusText");
  if (!statusSpan) return;

  if (isIndexBuilt) {
    statusSpan.textContent = `Ready (${globalEmbedIndex.size} embeds indexed)`;
    statusSpan.style.color = "#4ade80";
  } else {
    statusSpan.textContent = "Empty (Will fetch on first search)";
    statusSpan.style.color = "#a3b8cc";
  }
}

// Added Signal Parameter
async function fetchAndIndexAccount(apiKey, account, signal) {
  try {
    let nextUrl = `https://api.sightmap.com/v1/accounts/${account.id}/embeds?per-page=100`;

    while (nextUrl) {
      if (signal && signal.aborted)
        throw new DOMException("Aborted", "AbortError");

      const res = await fetch(nextUrl, {
        headers: {
          "API-Key": apiKey,
          "Experimental-Flags": "embed-resource",
        },
        signal: signal,
      });

      if (!res.ok) return;

      const json = await res.json();
      const embeds = json.data || [];

      embeds.forEach((embed) => {
        if (embed.url) {
          // Normalize the URL key before setting
          const key = normalizeUrl(embed.url.trim());
          globalEmbedIndex.set(key, {
            account: account,
            embed: embed,
          });
        }
      });

      nextUrl =
        json.paging && json.paging.next_url ? json.paging.next_url : null;
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      console.warn(`Error indexing account ${account.id}`, err);
    } else {
      throw err;
    }
  }
}

// Added Signal Parameter
async function fetchAllAccounts(apiKey, statusElem, signal) {
  let allAccounts = [];
  let nextUrl = "https://api.sightmap.com/v1/accounts?per-page=100";

  while (nextUrl) {
    if (signal && signal.aborted)
      throw new DOMException("Aborted", "AbortError");

    const res = await fetch(nextUrl, {
      headers: { "API-Key": apiKey },
      signal: signal,
    });

    if (!res.ok) throw new Error(`Failed to fetch accounts: ${res.status}`);

    const json = await res.json();
    allAccounts = allAccounts.concat(json.data || []);
    nextUrl = json.paging && json.paging.next_url ? json.paging.next_url : null;

    if (statusElem)
      statusElem.textContent = `Fetching account list... Found ${allAccounts.length} so far.`;
  }
  return allAccounts;
}

function displayEmbedResult(matchObj) {
  const container = document.getElementById("embedResultContainer");
  const embed = matchObj.embed;
  const account = matchObj.account;

  let assetId = "N/A";
  if (embed.sightmaps && embed.sightmaps.length > 0) {
    assetId = embed.sightmaps[0].asset_id;
  }

  document.getElementById("resAccountId").textContent = account.id;
  document.getElementById("resAccountName").textContent = account.name;
  document.getElementById("resAssetId").textContent = assetId;
  document.getElementById("resEmbedName").textContent = embed.name;

  container.style.display = "block";
}
