let allExpenses = [];
let uniqueTypes = new Set();
let uniqueCats = new Set();
let uniqueFreqs = new Set();

document.addEventListener('DOMContentLoaded', () => {
    // Buttons
    document.getElementById('fetchExpBtn').addEventListener('click', runSingleExpenseSearch);
    document.getElementById('bulkExpBtn').addEventListener('click', runBulkExpenseSearch);
    document.getElementById('copyExpJsonBtn').addEventListener('click', exportExpJSON);
    document.getElementById('downloadExpCsvBtn').addEventListener('click', downloadExpCSV);
    
    // NEW: Copy to Clipboard Button
    const copyClipBtn = document.getElementById('copyExpClipBtn');
    if (copyClipBtn) copyClipBtn.addEventListener('click', copyExpTable);

    // Filters
    document.getElementById('expFilterType').addEventListener('change', renderExpenseTable);
    document.getElementById('expFilterCat').addEventListener('change', renderExpenseTable);
    document.getElementById('expFilterFreq').addEventListener('change', renderExpenseTable);

    // Template
    document.getElementById('expTemplateLink').addEventListener('click', (e) => {
        e.preventDefault();
        const csvContent = "asset_id\n1323\n4500";
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", "expenses_template.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
});

async function runSingleExpenseSearch() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const assetId = document.getElementById('expAssetId').value.trim();
    if (!apiKey || !assetId) { alert("Please enter API Key and Asset ID"); return; }
    resetExpUI();
    updateExpStatus(`Fetching expenses for Asset ${assetId}...`);
    await fetchAndProcessExpenses(apiKey, assetId);
    if(allExpenses.length > 0) {
        populateExpFilters(allExpenses);
        renderExpenseTable();
        updateExpStatus(`✅ Done. Found ${allExpenses.length} expenses.`);
    } else {
        updateExpStatus(`⚠️ No expenses found for Asset ${assetId}.`);
    }
}

async function runBulkExpenseSearch() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const fileInput = document.getElementById('expCsvFile');
    if (!apiKey) { alert("Please enter API Key"); return; }
    if (fileInput.files.length === 0) { alert("Please select a CSV file"); return; }
    const file = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = async function(e) {
        const text = e.target.result;
        const assetIds = parseExpCSV(text);
        if (assetIds.length === 0) { alert("No Asset IDs found. Check CSV format."); return; }
        resetExpUI();
        updateExpStatus(`Found ${assetIds.length} assets. Starting bulk process...`);
        let processed = 0;
        for (const id of assetIds) {
            updateExpStatus(`Processing Asset ${id} (${processed + 1}/${assetIds.length})...`);
            await fetchAndProcessExpenses(apiKey, id);
            processed++;
            document.getElementById('expProgressBar').style.width = `${(processed / assetIds.length) * 100}%`;
            await new Promise(r => setTimeout(r, 0));
        }
        if(allExpenses.length > 0) {
            populateExpFilters(allExpenses);
            renderExpenseTable();
            updateExpStatus(`✅ Bulk Process Complete. Found ${allExpenses.length} total expenses.`);
        } else {
            updateExpStatus(`⚠️ Process complete, but no expenses returned.`);
        }
    };
    reader.readAsText(file);
}

async function fetchAndProcessExpenses(apiKey, assetId) {
    let assetName = "Unknown Asset";
    try {
        const nameRes = await fetch(`https://api.sightmap.com/v1/assets/${assetId}`, {
            method: 'GET',
            headers: { "API-Key": apiKey }
        });
        if(nameRes.ok) {
            const nameJson = await nameRes.json();
            if (nameJson.name) { assetName = nameJson.name; } 
            else if (nameJson.data && nameJson.data.name) { assetName = nameJson.data.name; }
        } 
    } catch(e) { console.warn("Error fetching name for " + assetId, e); }

    let nextUrl = `https://api.sightmap.com/v1/assets/${assetId}/multifamily/expenses?per-page=100`;
    try {
        while(nextUrl) {
            const response = await fetch(nextUrl, { method: 'GET', headers: { "API-Key": apiKey, "Experimental-Flags": "expenses" } });
            if (!response.ok) { if(response.status !== 404) console.warn(`Asset ${assetId} error: ${response.status}`); return; }
            const jsonData = await response.json();
            const data = jsonData.data || [];
            data.forEach(item => {
                let finalAmount = "N/A";
                if (item.value_type === "amount") { finalAmount = `$${item.amount}`; } 
                else if (item.value_type === "range") { finalAmount = `$${item.min_amount} - $${item.max_amount}`; }
                const matchObj = {
                    "asset_id": assetId,
                    "asset_name": assetName, 
                    "label": item.label,
                    "type": item.type,
                    "category": item.category,
                    "frequency": item.frequency,
                    "amount": finalAmount,
                    "is_required": item.is_required
                };
                allExpenses.push(matchObj);
            });
            nextUrl = jsonData.paging ? jsonData.paging.next_url : null;
        }
    } catch (error) { console.error(`Error processing asset ${assetId}:`, error); }
}

function populateExpFilters(data) {
    uniqueTypes.clear(); uniqueCats.clear(); uniqueFreqs.clear();
    data.forEach(item => {
        if(item.type) uniqueTypes.add(item.type);
        if(item.category) uniqueCats.add(item.category);
        if(item.frequency) uniqueFreqs.add(item.frequency);
    });
    const fill = (id, set, label) => {
        const sel = document.getElementById(id);
        const current = sel.value;
        sel.innerHTML = `<option value="ALL">${label}</option>`;
        sel.disabled = false;
        Array.from(set).sort().forEach(val => {
            const opt = document.createElement('option'); opt.value = val; opt.textContent = val.replace(/_/g, ' '); sel.appendChild(opt);
        });
        if(Array.from(set).includes(current)) sel.value = current;
    };
    fill('expFilterType', uniqueTypes, "All Types");
    fill('expFilterCat', uniqueCats, "All Categories");
    fill('expFilterFreq', uniqueFreqs, "All Frequencies");
}

function renderExpenseTable() {
    const tableBody = document.querySelector('#expTable tbody');
    tableBody.innerHTML = "";
    const typeFilter = document.getElementById('expFilterType').value;
    const catFilter = document.getElementById('expFilterCat').value;
    const freqFilter = document.getElementById('expFilterFreq').value;
    let visibleCount = 0;
    allExpenses.forEach(exp => {
        if (typeFilter !== "ALL" && exp.type !== typeFilter) return;
        if (catFilter !== "ALL" && exp.category !== catFilter) return;
        if (freqFilter !== "ALL" && exp.frequency !== freqFilter) return;
        visibleCount++;
        const reqBadge = exp.is_required ? `<span class="match-tag" style="background:#b91c1c; font-size:0.65rem;">YES</span>` : `<span style="color:#64748b; font-size:0.8rem;">No</span>`;
        const row = `<tr><td>${exp.asset_id}</td><td style="font-weight:600;">${exp.asset_name}</td><td style="font-weight:600; color:white;">${exp.label}</td><td><span class="match-tag" style="background:var(--col-slate); border:1px solid var(--col-purple);">${exp.type}</span></td><td>${exp.category}</td><td>${exp.frequency}</td><td style="font-family:monospace; color:var(--accent-light);">${exp.amount}</td><td style="text-align:center;">${reqBadge}</td></tr>`;
        tableBody.insertAdjacentHTML('beforeend', row);
    });
    document.getElementById('expCount').textContent = visibleCount;
}

function parseExpCSV(csvText) {
    const lines = csvText.split(/\r\n|\n/);
    const ids = [];
    let idIndex = 0; 
    const headers = lines[0].toLowerCase().split(',');
    const foundIndex = headers.findIndex(h => h.trim().includes('asset_id') || h.trim().includes('assetid'));
    if (foundIndex !== -1) idIndex = foundIndex;
    const startRow = (foundIndex !== -1) ? 1 : 0;
    for (let i = startRow; i < lines.length; i++) {
        const row = lines[i].split(',');
        if (row.length > idIndex) { const val = row[idIndex].trim(); if (val && !isNaN(val)) ids.push(val); }
    }
    return ids;
}

function resetExpUI() {
    allExpenses = [];
    document.querySelector('#expTable tbody').innerHTML = "";
    document.getElementById('expProgressBar').style.width = "0%";
    document.getElementById('expCount').textContent = "0";
    ['expFilterType', 'expFilterCat', 'expFilterFreq'].forEach(id => {
        const el = document.getElementById(id);
        el.innerHTML = `<option value="ALL">All...</option>`;
        el.disabled = true;
    });
}

function updateExpStatus(msg) { document.getElementById('expStatusMsg').textContent = msg; }

function exportExpJSON() {
    if(allExpenses.length === 0) { alert("No data"); return; }
    navigator.clipboard.writeText(JSON.stringify(allExpenses, null, 2));
    alert("Copied JSON");
}

function downloadExpCSV() {
    if(allExpenses.length === 0) { alert("No data"); return; }
    let csvContent = "asset_id,asset_name,label,type,category,frequency,amount,is_required\n";
    allExpenses.forEach(row => {
        const cleanName = (row.asset_name || "").replace(/"/g, '""');
        const cleanLabel = (row.label || "").replace(/"/g, '""');
        const cleanAmount = (row.amount || "").replace(/"/g, '""'); 
        csvContent += `${row.asset_id},"${cleanName}","${cleanLabel}",${row.type},${row.category},${row.frequency},"${cleanAmount}",${row.is_required}\n`;
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "asset_expenses.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// NEW FUNCTION: Copy Table to Clipboard
function copyExpTable() {
    if(allExpenses.length === 0) { alert("No data"); return; }
    
    let text = "Asset ID\tAsset Name\tLabel\tType\tCategory\tFrequency\tAmount\tRequired\n";
    allExpenses.forEach(r => {
        text += `${r.asset_id}\t${r.asset_name}\t${r.label}\t${r.type}\t${r.category}\t${r.frequency}\t${r.amount}\t${r.is_required}\n`;
    });
    
    navigator.clipboard.writeText(text);
    alert("Table copied to clipboard!");
}