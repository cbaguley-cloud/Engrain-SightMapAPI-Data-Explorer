let allUnitReferences = [];
let uniqueKeys = new Set(); 

document.addEventListener('DOMContentLoaded', () => {
    // Buttons
    document.getElementById('fetchUnitRefBtn').addEventListener('click', runSingleUnitRefSearch);
    document.getElementById('bulkUnitRefBtn').addEventListener('click', runBulkUnitRefSearch);
    document.getElementById('copyUnitRefJsonBtn').addEventListener('click', exportUnitRefJSON);
    document.getElementById('downloadUnitRefCsvBtn').addEventListener('click', downloadUnitRefCSV);
    
    // NEW: Copy to Clipboard Button
    const copyClipBtn = document.getElementById('copyUnitRefClipBtn');
    if (copyClipBtn) copyClipBtn.addEventListener('click', copyUnitRefTable);

    // Filters
    document.getElementById('unitRefKeyFilter').addEventListener('change', renderUnitRefTable);

    // Template
    document.getElementById('unitRefTemplateLink').addEventListener('click', (e) => {
        e.preventDefault();
        const csvContent = "asset_id\n1323\n4500";
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", "unit_references_template.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
});

// ==========================================
// OPTION A: Single Search
// ==========================================
async function runSingleUnitRefSearch() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const assetId = document.getElementById('unitRefAssetId').value.trim();
    
    if (!apiKey || !assetId) { alert("Please enter API Key and Asset ID"); return; }

    resetUnitRefUI();
    updateUnitRefStatus(`Fetching unit references for Asset ${assetId}...`);
    
    await processAssetUnitReferences(apiKey, assetId);
    
    if(allUnitReferences.length > 0) {
        updateUnitRefStatus(`✅ Done. Found ${allUnitReferences.length} unit references.`);
    } else {
        updateUnitRefStatus(`⚠️ No unit references found for Asset ${assetId}.`);
    }
}

// ==========================================
// OPTION B: Bulk CSV Search
// ==========================================
async function runBulkUnitRefSearch() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const fileInput = document.getElementById('unitRefCsvFile');
    
    if (!apiKey) { alert("Please enter API Key"); return; }
    if (fileInput.files.length === 0) { alert("Please select a CSV file"); return; }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async function(e) {
        const text = e.target.result;
        const assetIds = parseUnitRefCSV(text);

        if (assetIds.length === 0) {
            alert("No Asset IDs found. Check CSV format (header: asset_id).");
            return;
        }

        resetUnitRefUI();
        updateUnitRefStatus(`Found ${assetIds.length} assets. Starting bulk process...`);

        // Loop through assets
        let processed = 0;
        for (const id of assetIds) {
            updateUnitRefStatus(`Processing Asset ${id} (${processed + 1}/${assetIds.length})...`);
            
            await processAssetUnitReferences(apiKey, id);
            
            processed++;
            document.getElementById('unitRefProgressBar').style.width = `${(processed / assetIds.length) * 100}%`;
            
            // Critical: Yield to main thread to allow UI/Progress Bar to update
            await new Promise(r => setTimeout(r, 0));
        }

        updateUnitRefStatus(`✅ Bulk Process Complete. Found ${allUnitReferences.length} total unit references.`);
    };

    reader.readAsText(file);
}

// ==========================================
// CORE LOGIC (Chain 2 Endpoints)
// ==========================================
async function processAssetUnitReferences(apiKey, assetId) {
    try {
        // Step 1: Get Reference Groups
        const groups = await fetchReferenceGroups(apiKey, assetId);

        if (groups.length === 0) {
            return;
        }

        // Step 2: For each group, get the actual Unit References
        for (const group of groups) {
            await fetchUnitReferencesForGroup(apiKey, assetId, group);
        }

    } catch (error) {
        console.error(`Error processing asset ${assetId}:`, error);
    }
}

async function fetchReferenceGroups(apiKey, assetId) {
    let allGroups = [];
    let nextUrl = `https://api.sightmap.com/v1/assets/${assetId}/multifamily/units/reference-groups?per-page=100`;

    try {
        while(nextUrl) {
            const response = await fetch(nextUrl, {
                method: 'GET',
                headers: { 
                    "API-Key": apiKey,
                    "Experimental-Flags": "references"
                }
            });

            if (!response.ok) {
                 // 404 means asset not found or no groups
                 if(response.status !== 404) console.warn(`Error fetching groups for ${assetId}: ${response.status}`);
                 return [];
            }

            const jsonData = await response.json();
            allGroups = allGroups.concat(jsonData.data || []);
            nextUrl = jsonData.paging ? jsonData.paging.next_url : null;
        }
    } catch (e) {
        console.warn(e);
    }
    return allGroups;
}

async function fetchUnitReferencesForGroup(apiKey, assetId, group) {
    let nextUrl = `https://api.sightmap.com/v1/assets/${assetId}/multifamily/units/reference-groups/${group.id}/references?per-page=100`;

    try {
        while(nextUrl) {
            const response = await fetch(nextUrl, {
                method: 'GET',
                headers: { 
                    "API-Key": apiKey,
                    "Experimental-Flags": "references"
                }
            });

            if (!response.ok) return;

            const jsonData = await response.json();
            const refData = jsonData.data || [];

            refData.forEach(ref => {
                const matchObj = {
                    "asset_id": assetId,
                    "group_name": group.name, // From Step 1
                    "group_id": group.id,
                    "unit_id": ref.unit_id,
                    "key": ref.key,
                    "value": ref.value
                };

                allUnitReferences.push(matchObj);
                
                // Track Unique Key & Update Dropdown
                if(ref.key && !uniqueKeys.has(ref.key)) {
                    uniqueKeys.add(ref.key);
                    updateFilterDropdown();
                }
            });

            // Re-render table with new data (respecting current filter)
            renderUnitRefTable();

            nextUrl = jsonData.paging ? jsonData.paging.next_url : null;
            
            // Yield during pagination loops as well
            await new Promise(r => setTimeout(r, 0));
        }
    } catch (e) {
        console.warn(e);
    }
}

// ==========================================
// UTILITIES & RENDERING
// ==========================================

function updateFilterDropdown() {
    const select = document.getElementById('unitRefKeyFilter');
    const currentValue = select.value;
    
    // Keep "ALL" option
    select.innerHTML = '<option value="ALL">Show All Keys</option>';
    
    // Sort keys alphabetically
    Array.from(uniqueKeys).sort().forEach(key => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = key;
        select.appendChild(option);
    });

    // Restore previous selection if valid
    select.value = currentValue;
}

function renderUnitRefTable() {
    const tableBody = document.querySelector('#unitRefTable tbody');
    const filterValue = document.getElementById('unitRefKeyFilter').value;
    
    tableBody.innerHTML = "";
    
    let visibleCount = 0;

    allUnitReferences.forEach(ref => {
        // Filter Logic
        if (filterValue !== "ALL" && ref.key !== filterValue) {
            return; // Skip this row
        }
        visibleCount++;

        const row = `<tr>
            <td>${ref.asset_id}</td>
            <td style="color:var(--accent-light);">${ref.group_name}</td>
            <td style="font-family:monospace;">${ref.unit_id}</td>
            <td><span class="match-tag" style="background:#27272a; color:#fff; border:1px solid #444;">${ref.key}</span></td>
            <td style="font-family:monospace; font-size:0.9em;">${ref.value}</td>
        </tr>`;
        tableBody.insertAdjacentHTML('beforeend', row);
    });
    
    // Update Count
    const countSpan = document.getElementById('unitRefCount');
    if(countSpan) countSpan.textContent = visibleCount;
}

function parseUnitRefCSV(csvText) {
    const lines = csvText.split(/\r\n|\n/);
    const ids = [];
    let idIndex = 0; 

    const headers = lines[0].toLowerCase().split(',');
    const foundIndex = headers.findIndex(h => h.trim().includes('asset_id') || h.trim().includes('assetid'));
    if (foundIndex !== -1) idIndex = foundIndex;

    const startRow = (foundIndex !== -1) ? 1 : 0;

    for (let i = startRow; i < lines.length; i++) {
        const row = lines[i].split(',');
        if (row.length > idIndex) {
            const val = row[idIndex].trim();
            if (val && !isNaN(val)) ids.push(val);
        }
    }
    return ids;
}

function resetUnitRefUI() {
    allUnitReferences = [];
    uniqueKeys = new Set();
    document.getElementById('unitRefKeyFilter').innerHTML = '<option value="ALL">Show All Keys</option>';
    document.querySelector('#unitRefTable tbody').innerHTML = "";
    document.getElementById('unitRefProgressBar').style.width = "0%";
    
    const countSpan = document.getElementById('unitRefCount');
    if(countSpan) countSpan.textContent = "0";
}

function updateUnitRefStatus(msg) {
    document.getElementById('unitRefStatusMsg').textContent = msg;
}

function exportUnitRefJSON() {
    if(allUnitReferences.length === 0) { alert("No data"); return; }
    navigator.clipboard.writeText(JSON.stringify(allUnitReferences, null, 2));
    alert("Copied JSON");
}

function downloadUnitRefCSV() {
    if(allUnitReferences.length === 0) { alert("No data"); return; }
    let csvContent = "asset_id,group_name,group_id,unit_id,key,value\n";
    allUnitReferences.forEach(row => {
        const cleanName = row.group_name ? row.group_name.replace(/"/g, '""') : "";
        const cleanValue = row.value ? row.value.replace(/"/g, '""') : "";
        
        csvContent += `${row.asset_id},"${cleanName}",${row.group_id},${row.unit_id},${row.key},"${cleanValue}"\n`;
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "unit_references.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// NEW FUNCTION: Copy Table to Clipboard (TSV)
function copyUnitRefTable() {
    if(allUnitReferences.length === 0) { alert("No data"); return; }
    
    let text = "Asset ID\tGroup Name\tUnit ID\tKey\tValue\n";
    allUnitReferences.forEach(r => {
        text += `${r.asset_id}\t${r.group_name}\t${r.unit_id}\t${r.key}\t${r.value}\n`;
    });
    
    navigator.clipboard.writeText(text);
    alert("Table copied to clipboard!");
}