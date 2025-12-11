let allFetchedAssets = [];

document.addEventListener('DOMContentLoaded', () => {
    // Buttons
    document.getElementById('fetchListBtn').addEventListener('click', runListAssets);
    document.getElementById('copyListJsonBtn').addEventListener('click', exportListJSON);
    document.getElementById('downloadListCsvBtn').addEventListener('click', downloadListCSV);
    
    // NEW: Copy to Clipboard Button
    const copyClipBtn = document.getElementById('copyListClipBtn');
    if (copyClipBtn) copyClipBtn.addEventListener('click', copyListTable);
});

async function runListAssets() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const cityFilter = document.getElementById('filterCity').value.trim().toLowerCase();
    const stateFilter = document.getElementById('filterState').value.trim().toLowerCase();
    const tagFilter = document.getElementById('filterTag').value.trim().toLowerCase();

    if (!apiKey) { alert("Please enter API Key."); return; }

    resetListUI();
    updateListStatus("Fetching all assets (handling pagination)...");
    
    try {
        const rawAssets = await fetchAllAssetsList(apiKey);
        const filteredAssets = rawAssets.filter(asset => {
            const assetCity = (asset.address_city || "").toLowerCase();
            const assetState = (asset.address_state || "").toLowerCase();
            const assetTags = (asset.tags || []).map(t => t.toLowerCase());
            if (cityFilter && !assetCity.includes(cityFilter)) return false;
            if (stateFilter && !assetState.includes(stateFilter)) return false;
            if (tagFilter) {
                const tagMatch = assetTags.some(t => t.includes(tagFilter));
                if (!tagMatch) return false;
            }
            return true;
        });

        allFetchedAssets = filteredAssets; 
        renderListTable(filteredAssets);
        
        if (filteredAssets.length > 0) {
            updateListStatus(`✅ Done. Showing ${filteredAssets.length} assets (out of ${rawAssets.length} total).`);
        } else {
            updateListStatus(`⚠️ Fetched ${rawAssets.length} assets, but none matched your filters.`);
        }

    } catch (error) {
        console.error(error);
        updateListStatus(`❌ Error: ${error.message}`);
    }
}

async function fetchAllAssetsList(apiKey) {
    let assets = [];
    let nextUrl = `https://api.sightmap.com/v1/assets?per-page=500`; 
    let page = 0;

    while (nextUrl) {
        const response = await fetch(nextUrl, { method: 'GET', headers: { "API-Key": apiKey } });
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        const json = await response.json();
        const data = json.data || [];
        
        for(const d of data) assets.push(d);
        
        nextUrl = json.paging ? json.paging.next_url : null;
        
        page++;
        const prog = Math.min(page * 5, 95);
        document.getElementById('listProgressBar').style.width = `${prog}%`;
        updateListStatus(`Fetching... (Loaded ${assets.length} assets)`);

        await new Promise(r => setTimeout(r, 0));
    }
    
    document.getElementById('listProgressBar').style.width = "100%";
    return assets;
}

function renderListTable(assets) {
    const tableBody = document.querySelector('#assetListTable tbody');
    tableBody.innerHTML = "";
    assets.forEach(asset => {
        let tagsHtml = "";
        if (asset.tags && Array.isArray(asset.tags)) {
            tagsHtml = asset.tags.map(t => `<span class="match-tag" style="font-size:0.7em; background:var(--col-slate); border:1px solid var(--col-purple);">${t}</span>`).join(" ");
        }
        const row = `<tr><td style="font-family:monospace; color:var(--accent-light);">${asset.id}</td><td style="font-weight:600;">${asset.name}</td><td>${asset.address_line1 || ""}</td><td>${asset.address_city || ""}</td><td>${asset.address_state || ""}</td><td>${tagsHtml}</td></tr>`;
        tableBody.insertAdjacentHTML('beforeend', row);
    });
    document.getElementById('globalListCount').textContent = assets.length;
}

function resetListUI() {
    allFetchedAssets = [];
    document.querySelector('#assetListTable tbody').innerHTML = "";
    document.getElementById('listProgressBar').style.width = "0%";
    document.getElementById('globalListCount').textContent = "0";
}

function updateListStatus(msg) { document.getElementById('listStatusMsg').textContent = msg; }

function exportListJSON() { 
    if(allFetchedAssets.length === 0) { alert("No data"); return; } 
    navigator.clipboard.writeText(JSON.stringify(allFetchedAssets, null, 2)); 
    alert("Copied JSON"); 
}

function downloadListCSV() { 
    if(allFetchedAssets.length === 0) { alert("No data"); return; } 
    let csvContent = "id,name,address_line1,address_city,address_state,tags\n"; 
    allFetchedAssets.forEach(a => { 
        const cleanName = (a.name || "").replace(/"/g, '""'); 
        const cleanAddr = (a.address_line1 || "").replace(/"/g, '""'); 
        const tagsStr = (a.tags || []).join(";"); 
        csvContent += `${a.id},"${cleanName}","${cleanAddr}","${a.address_city || ""}","${a.address_state || ""}","${tagsStr}"\n`; 
    }); 
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); 
    const link = document.createElement("a"); 
    const url = URL.createObjectURL(blob); 
    link.setAttribute("href", url); 
    link.setAttribute("download", "asset_list.csv"); 
    document.body.appendChild(link); 
    link.click(); 
    document.body.removeChild(link); 
}

// NEW FUNCTION: Copy Table to Clipboard
function copyListTable() {
    if(allFetchedAssets.length === 0) { alert("No data"); return; }
    
    let text = "Asset ID\tName\tAddress\tCity\tState\tTags\n";
    allFetchedAssets.forEach(a => {
        const tags = (a.tags || []).join(", ");
        text += `${a.id}\t${a.name}\t${a.address_line1 || ""}\t${a.address_city || ""}\t${a.address_state || ""}\t${tags}\n`;
    });
    
    navigator.clipboard.writeText(text);
    alert("Table copied to clipboard!");
}