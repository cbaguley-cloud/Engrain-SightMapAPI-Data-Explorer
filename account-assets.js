let allAcctAssets = [];
let uniqueCities = new Set();
let uniqueStates = new Set();
let uniqueTags = new Set();

document.addEventListener('DOMContentLoaded', () => {
    // Buttons
    document.getElementById('fetchAcctAssetsBtn').addEventListener('click', runAccountAssetFetch);
    document.getElementById('copyAcctAssetJsonBtn').addEventListener('click', exportAcctAssetJSON);
    document.getElementById('downloadAcctAssetCsvBtn').addEventListener('click', downloadAcctAssetCSV);
    
    // NEW: Copy to Clipboard Button
    const copyClipBtn = document.getElementById('copyAcctClipBtn');
    if (copyClipBtn) copyClipBtn.addEventListener('click', copyAcctTable);

    // Filter Listeners
    document.getElementById('acctFilterCity').addEventListener('change', renderAcctAssetTable);
    document.getElementById('acctFilterState').addEventListener('change', renderAcctAssetTable);
    document.getElementById('acctFilterTag').addEventListener('change', renderAcctAssetTable);
});

async function runAccountAssetFetch() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const accountId = document.getElementById('acctAssetAccountId').value.trim();
    if (!apiKey) { alert("Please enter API Key."); return; }
    if (!accountId) { alert("Please enter Account ID."); return; }
    resetAcctAssetUI();
    updateAcctAssetStatus(`Fetching assets for Account ${accountId}...`);
    try {
        const assets = await fetchAllAccountAssets(apiKey, accountId);
        if (assets.length === 0) { updateAcctAssetStatus(`⚠️ No assets found for Account ${accountId}.`); return; }
        allAcctAssets = assets;
        populateAcctFilters(assets);
        renderAcctAssetTable();
        updateAcctAssetStatus(`✅ Done. Showing ${assets.length} assets.`);
    } catch (error) { console.error(error); updateAcctAssetStatus(`❌ Error: ${error.message}`); }
}

async function fetchAllAccountAssets(apiKey, accountId) {
    let assets = [];
    let nextUrl = `https://api.sightmap.com/v1/accounts/${accountId}/assets?per-page=500`; 
    while (nextUrl) {
        const response = await fetch(nextUrl, { method: 'GET', headers: { "API-Key": apiKey, "Experimental-Flags": "accounts-assets" } });
        if (!response.ok) {
            if(response.status === 400 || response.status === 404) throw new Error(`API Error ${response.status}: Check Account ID or Permissions.`);
            throw new Error(`API Error: ${response.status}`);
        }
        const json = await response.json();
        const data = json.data || [];
        assets = assets.concat(data);
        nextUrl = json.paging ? json.paging.next_url : null;
        updateAcctAssetStatus(`Fetching... (Loaded ${assets.length} assets)`);
        await new Promise(r => setTimeout(r, 0));
    }
    return assets;
}

function populateAcctFilters(assets) {
    uniqueCities.clear(); uniqueStates.clear(); uniqueTags.clear();
    assets.forEach(asset => {
        if (asset.address_city) uniqueCities.add(asset.address_city);
        if (asset.address_state) uniqueStates.add(asset.address_state);
        if (asset.tags && Array.isArray(asset.tags)) { asset.tags.forEach(t => uniqueTags.add(t)); }
    });
    const fillSelect = (id, set, placeholder) => {
        const select = document.getElementById(id);
        select.innerHTML = `<option value="ALL">${placeholder}</option>`;
        select.disabled = false;
        Array.from(set).sort().forEach(val => {
            const option = document.createElement('option'); option.value = val; option.textContent = val; select.appendChild(option);
        });
    };
    fillSelect('acctFilterCity', uniqueCities, "All Cities");
    fillSelect('acctFilterState', uniqueStates, "All States");
    fillSelect('acctFilterTag', uniqueTags, "All Tags");
}

function renderAcctAssetTable() {
    const tableBody = document.querySelector('#acctAssetTable tbody');
    tableBody.innerHTML = "";
    const cityFilter = document.getElementById('acctFilterCity').value;
    const stateFilter = document.getElementById('acctFilterState').value;
    const tagFilter = document.getElementById('acctFilterTag').value;
    let visibleCount = 0;

    allAcctAssets.forEach(asset => {
        const assetCity = asset.address_city || "";
        const assetState = asset.address_state || "";
        const assetTags = asset.tags || [];
        if (cityFilter !== "ALL" && assetCity !== cityFilter) return;
        if (stateFilter !== "ALL" && assetState !== stateFilter) return;
        if (tagFilter !== "ALL" && !assetTags.includes(tagFilter)) return;

        visibleCount++;
        let tagsHtml = assetTags.map(t => `<span class="match-tag" style="font-size:0.7em; background:var(--col-slate); border:1px solid var(--col-purple);">${t}</span>`).join(" ");
        const row = `<tr><td style="font-family:monospace; color:var(--accent-light);">${asset.id}</td><td style="font-weight:600;">${asset.name}</td><td>${asset.address_line1 || ""}</td><td>${assetCity}</td><td>${assetState}</td><td>${tagsHtml}</td></tr>`;
        tableBody.insertAdjacentHTML('beforeend', row);
    });
    document.getElementById('acctAssetCount').textContent = visibleCount;
}

function resetAcctAssetUI() {
    allAcctAssets = [];
    document.querySelector('#acctAssetTable tbody').innerHTML = "";
    document.getElementById('acctAssetProgressBar').style.width = "0%";
    document.getElementById('acctAssetCount').textContent = "0";
    
    // Reset Filters
    ['acctFilterCity', 'acctFilterState', 'acctFilterTag'].forEach(id => {
        const el = document.getElementById(id);
        el.innerHTML = `<option value="ALL">All...</option>`;
        el.disabled = true;
    });
}

function updateAcctAssetStatus(msg) { document.getElementById('acctAssetStatusMsg').textContent = msg; }

function exportAcctAssetJSON() { 
    if(allAcctAssets.length === 0) { alert("No data"); return; } 
    navigator.clipboard.writeText(JSON.stringify(allAcctAssets, null, 2)); 
    alert("Copied JSON"); 
}

function downloadAcctAssetCSV() { 
    if(allAcctAssets.length === 0) { alert("No data"); return; } 
    let csvContent = "id,name,address_line1,address_city,address_state,tags\n"; 
    allAcctAssets.forEach(a => { 
        const cleanName = (a.name || "").replace(/"/g, '""'); 
        const cleanAddr = (a.address_line1 || "").replace(/"/g, '""'); 
        const tagsStr = (a.tags || []).join(";"); 
        csvContent += `${a.id},"${cleanName}","${cleanAddr}","${a.address_city || ""}","${a.address_state || ""}","${tagsStr}"\n`; 
    }); 
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); 
    const link = document.createElement("a"); 
    const url = URL.createObjectURL(blob); 
    link.setAttribute("href", url); 
    link.setAttribute("download", "account_assets.csv"); 
    document.body.appendChild(link); 
    link.click(); 
    document.body.removeChild(link); 
}

// NEW FUNCTION: Copy Table to Clipboard
function copyAcctTable() {
    if(allAcctAssets.length === 0) { alert("No data"); return; }
    
    let text = "Asset ID\tName\tAddress\tCity\tState\tTags\n";
    allAcctAssets.forEach(a => {
        const tags = (a.tags || []).join(", ");
        text += `${a.id}\t${a.name}\t${a.address_line1 || ""}\t${a.address_city || ""}\t${a.address_state || ""}\t${tags}\n`;
    });
    
    navigator.clipboard.writeText(text);
    alert("Table copied to clipboard!");
}