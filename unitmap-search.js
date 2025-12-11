// Global storage for matches
let allMatches = [];

document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. Buttons (With Safety Checks) ---
    const fetchBtn = document.getElementById('fetchBtn');
    if (fetchBtn) fetchBtn.addEventListener('click', runSingleSearch);

    const bulkBtn = document.getElementById('bulkBtn');
    if (bulkBtn) bulkBtn.addEventListener('click', runBulkSearch);

    const copyBtn = document.getElementById('copyBtn');
    if (copyBtn) copyBtn.addEventListener('click', exportJSON);

    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) downloadBtn.addEventListener('click', downloadCSV);

    // NEW: Copy to Clipboard Button
    const copyClipBtn = document.getElementById('copyMapClipBtn');
    if (copyClipBtn) copyClipBtn.addEventListener('click', copyMapTable);
    
    // --- 2. Download Template Link ---
    const templateLink = document.getElementById('mapTemplateLink');
    if (templateLink) {
        templateLink.addEventListener('click', (e) => {
            e.preventDefault();
            const csvContent = "asset_id\n7779\n12345";
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", "map_search_template.csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    }

    // --- 3. Select All Logic ---
    const selectAllCheckbox = document.getElementById('selectAllStyles');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', function() {
            // Find all checkboxes with name="style" inside the map tab
            const checkboxes = document.querySelectorAll('input[name="style"]');
            checkboxes.forEach(cb => cb.checked = this.checked);
        });
    }
});

// Helper: Get selected styles
function getSelectedStyles() {
    const checkboxes = document.querySelectorAll('input[name="style"]:checked');
    return Array.from(checkboxes).map(cb => cb.value.toLowerCase());
}

// ==========================================
// OPTION A: Single Search
// ==========================================
async function runSingleSearch() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const assetId = document.getElementById('assetId').value.trim();
    const targetStyles = getSelectedStyles();
    
    if (!apiKey || !assetId) { alert("Please enter API Key and Asset ID"); return; }
    if (targetStyles.length === 0) { alert("Please select at least one Map Style."); return; }

    resetUI();
    updateStatus(`Fetching maps for Asset ${assetId}...`);
    
    await fetchAndProcessAsset(apiKey, assetId, targetStyles);
    
    if (allMatches.length > 0) {
        updateStatus(`✅ Done. Found ${allMatches.length} matches.`);
    } else {
        updateStatus(`⚠️ No matches found for styles: ${targetStyles.join(', ')}`);
    }
    
    // UPDATE COUNT
    document.getElementById('mapCount').textContent = allMatches.length;
}

// ==========================================
// OPTION B: Bulk CSV Search
// ==========================================
async function runBulkSearch() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const fileInput = document.getElementById('csvFile');
    const targetStyles = getSelectedStyles();
    
    if (!apiKey) { alert("Please enter API Key"); return; }
    if (targetStyles.length === 0) { alert("Please select at least one Map Style."); return; }
    if (!fileInput || fileInput.files.length === 0) { alert("Please select a CSV file"); return; }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async function(e) {
        const text = e.target.result;
        const assetIds = parseCSV(text);

        if (assetIds.length === 0) {
            alert("No Asset IDs found. Check CSV format.");
            return;
        }

        resetUI();
        updateStatus(`Found ${assetIds.length} assets. Starting bulk process...`);

        // Loop through assets
        let processed = 0;
        for (const id of assetIds) {
            updateStatus(`Processing Asset ${id} (${processed + 1}/${assetIds.length})...`);
            
            await fetchAndProcessAsset(apiKey, id, targetStyles);
            
            processed++;
            const progressBar = document.getElementById('progressBar');
            if (progressBar) progressBar.style.width = `${(processed / assetIds.length) * 100}%`;
            
            // UPDATE COUNT DYNAMICALLY
            document.getElementById('mapCount').textContent = allMatches.length;
        }

        updateStatus(`✅ Bulk Process Complete. Found ${allMatches.length} total matches.`);
    };

    reader.readAsText(file);
}

// ==========================================
// CORE LOGIC
// ==========================================
async function fetchAndProcessAsset(apiKey, assetId, targetStyles) {
    try {
        const response = await fetch(
            `https://api.sightmap.com/v1/assets/${assetId}/multifamily/maps?page=1&per-page=500`, 
            {
                method: 'GET',
                headers: { "API-Key": apiKey }
            }
        );

        if (!response.ok) {
            console.warn(`Asset ${assetId} failed: ${response.status}`);
            return; 
        }

        const jsonData = await response.json();
        const mapData = jsonData.data || [];

        mapData.forEach(map => {
            // Check if style exists and matches our selection
            if (map.style && targetStyles.includes(map.style.toLowerCase())) {
                
                const matchObj = {
                    "asset_id": assetId,
                    "id": map.id,
                    "name": map.name,
                    "style": map.style
                };

                allMatches.push(matchObj);
                addTableRow(matchObj);
            }
        });

    } catch (error) {
        console.error(`Error processing asset ${assetId}:`, error);
    }
}

// ==========================================
// UTILITIES
// ==========================================

function parseCSV(csvText) {
    const lines = csvText.split(/\r\n|\n/);
    const ids = [];
    let idIndex = 0; 

    // Look for header row
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

function addTableRow(map) {
    const tableBody = document.querySelector('#resultsTable tbody');
    if (!tableBody) return;

    const row = `<tr>
            <td>${map.asset_id}</td>
            <td>${map.name}</td>
            <td>${map.id}</td>
            <td><span class="match-tag">${map.style}</span></td>
        </tr>`;
    tableBody.insertAdjacentHTML('beforeend', row);
}

function resetUI() {
    allMatches = [];
    const tbody = document.querySelector('#resultsTable tbody');
    if (tbody) tbody.innerHTML = "";
    
    const progressBar = document.getElementById('progressBar');
    if (progressBar) progressBar.style.width = "0%";
    
    // RESET COUNT
    document.getElementById('mapCount').textContent = "0";
}

function updateStatus(msg) {
    const statusDiv = document.getElementById('statusMsg');
    if (statusDiv) statusDiv.textContent = msg;
}

function exportJSON() {
    if(allMatches.length === 0) { alert("No data"); return; }
    navigator.clipboard.writeText(JSON.stringify(allMatches, null, 2));
    alert("Copied JSON");
}

function downloadCSV() {
    if(allMatches.length === 0) { alert("No data"); return; }
    let csvContent = "asset_id,map_name,map_id,style\n";
    allMatches.forEach(row => {
        csvContent += `${row.asset_id},"${row.name}",${row.id},${row.style}\n`;
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "sightmap_matches.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// NEW FUNCTION: Copy Table to Clipboard (TSV format)
function copyMapTable() {
    if(allMatches.length === 0) { alert("No data"); return; }
    
    // Create Tab-Separated Values (Excel friendly)
    let text = "Asset ID\tMap Name\tMap ID\tStyle\n";
    allMatches.forEach(r => {
        text += `${r.asset_id}\t${r.name}\t${r.id}\t${r.style}\n`;
    });
    
    navigator.clipboard.writeText(text);
    alert("Table copied to clipboard!");
}