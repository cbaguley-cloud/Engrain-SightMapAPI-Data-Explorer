// GLOBAL HASH INDEX
const globalEmbedIndex = new Map();
let isIndexBuilt = false;

document.addEventListener("DOMContentLoaded", () => {
  const embedBtn = document.getElementById("findEmbedBtn");
  if (embedBtn) embedBtn.addEventListener("click", runEmbedSearch);
});

async function runEmbedSearch() {
  const apiKey = document.getElementById("apiKey").value.trim();
  const targetUrl = document.getElementById("embedUrlInput").value.trim();
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

  // 1. CHECK INDEX
  if (isIndexBuilt) {
    console.log("Checking Cache Index...");
    const cachedMatch = globalEmbedIndex.get(targetUrl);
    if (cachedMatch) {
      statusDiv.textContent = "Match found in Cache!";
      displayEmbedResult(cachedMatch);
    } else {
      statusDiv.textContent = "URL not found in cached index.";
      resultDiv.style.display = "none";
    }
    return;
  }

  // 2. BUILD INDEX
  resultDiv.style.display = "none";
  statusDiv.textContent = "Initializing Index Build...";

  try {
    const accounts = await fetchAllAccounts(apiKey, statusDiv);

    if (accounts.length === 0) {
      statusDiv.textContent = "No accounts found.";
      return;
    }

    statusDiv.textContent = `Building Index: Scanning ${accounts.length} accounts...`;

    // Process in batches
    const BATCH_SIZE = 15;
    let processedCount = 0;

    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
      const batch = accounts.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map((acc) =>
        fetchAndIndexAccount(apiKey, acc)
      );
      await Promise.all(batchPromises);

      processedCount += batch.length;

      // Update UI
      const percent = Math.round((processedCount / accounts.length) * 100);
      statusDiv.textContent = `Indexing: ${percent}% complete (${processedCount}/${accounts.length} accounts scanned)...`;

      // Early exit if found (Optional)
      if (globalEmbedIndex.has(targetUrl)) {
        statusDiv.textContent = "Match Found during indexing!";
        displayEmbedResult(globalEmbedIndex.get(targetUrl));
      }
    }

    isIndexBuilt = true;

    // Final Lookup
    const match = globalEmbedIndex.get(targetUrl);
    if (match) {
      statusDiv.textContent = "Index Complete. Match Found!";
      displayEmbedResult(match);
    } else {
      statusDiv.textContent = `Index Complete. Scanned ${globalEmbedIndex.size} embeds, but URL not found.`;
    }
  } catch (error) {
    console.error(error);
    statusDiv.textContent = `Error: ${error.message}`;
  }
}

// HELPER: Fetch embeds & Index
async function fetchAndIndexAccount(apiKey, account) {
  try {
    let nextUrl = `https://api.sightmap.com/v1/accounts/${account.id}/embeds?per-page=100`;

    while (nextUrl) {
      const res = await fetch(nextUrl, {
        headers: {
          "API-Key": apiKey,
          "Experimental-Flags": "embed-resource",
        },
      });

      if (!res.ok) return;

      const json = await res.json();
      const embeds = json.data || [];

      embeds.forEach((embed) => {
        if (embed.url) {
          globalEmbedIndex.set(embed.url.trim(), {
            account: account,
            embed: embed,
          });
        }
      });

      nextUrl =
        json.paging && json.paging.next_url ? json.paging.next_url : null;
    }
  } catch (err) {
    console.warn(`Error indexing account ${account.id}`, err);
  }
}

// HELPER: Fetch ALL Accounts
async function fetchAllAccounts(apiKey, statusElem) {
  let allAccounts = [];
  let nextUrl = "https://api.sightmap.com/v1/accounts?per-page=100";

  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: { "API-Key": apiKey } });
    if (!res.ok) throw new Error(`Failed to fetch accounts: ${res.status}`);

    const json = await res.json();
    allAccounts = allAccounts.concat(json.data || []);
    nextUrl = json.paging && json.paging.next_url ? json.paging.next_url : null;

    if (statusElem)
      statusElem.textContent = `Fetching account list... Found ${allAccounts.length} so far.`;
  }
  return allAccounts;
}

// HELPER: Display
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
