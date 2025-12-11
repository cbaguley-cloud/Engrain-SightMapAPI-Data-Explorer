let assetResults = [];

document.addEventListener('DOMContentLoaded', () => {
    // Buttons
    document.getElementById('findAssetBtn').addEventListener('click', runSingleAssetSearch);
    document.getElementById('assetBulkBtn').addEventListener('click', runBulkAssetSearch);
    document.getElementById('downloadAssetBtn').addEventListener('click', downloadAssetCSV);
    
    // NEW: Copy to Clipboard Button
    const copyClipBtn = document.getElementById('copyFuzzyClipBtn');
    if (copyClipBtn) copyClipBtn.addEventListener('click', copyFuzzyTable);

    // Template
    document.getElementById('assetTemplateLink').addEventListener('click', (e) => {
        e.preventDefault();
        const csvContent = "Property Name,City,State\nGreenwood Apartments,Denver,CO\nSunrise Villas,Austin,TX";
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", "asset_fuzzy_template.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
});

async function runSingleAssetSearch() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const accountId = document.getElementById('accountId').value.trim();
    const name = document.getElementById('searchName').value.trim();
    const city = document.getElementById('searchCity').value.trim();
    const state = document.getElementById('searchState').value.trim();
    
    if (!apiKey) { alert("Please enter API Key."); return; }
    if (!accountId) { alert("Please enter Account ID."); return; }
    if (!name) { alert("Please enter at least a Name."); return; }

    resetAssetUI();
    updateAssetStatus("Fetching full asset list (handling pagination)...");

    try {
        const allAssets = await fetchAllAssets(apiKey, accountId);
        updateAssetStatus(`Scanning ${allAssets.length} assets against input...`);
        
        const inputRows = [{ propertyName: name, city: city, state: state }];
        const matches = performMatching(inputRows, allAssets);
        
        renderResults(matches);
        assetResults = matches; 
        
        if(matches[0].score > 0) { 
            updateAssetStatus(`✅ Match found: ${matches[0].matchedName}`); 
        } else { 
            updateAssetStatus("❌ No matches found."); 
        }
        
        document.getElementById('fuzzyCount').textContent = matches.length;

    } catch (error) { 
        console.error(error); 
        updateAssetStatus(`❌ Error: ${error.message}`); 
    }
}

async function runBulkAssetSearch() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const accountId = document.getElementById('accountId').value.trim();
    const fileInput = document.getElementById('assetCsvFile');
    
    if (!apiKey) { alert("Please enter API Key."); return; }
    if (!accountId) { alert("Please enter Account ID."); return; }
    if (fileInput.files.length === 0) { alert("Please select a CSV."); return; }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async function(e) {
        const csvText = e.target.result;
        const lines = csvText.split(/\r?\n/).filter(Boolean);
        
        if (lines[0].toLowerCase().includes('asset_name') || lines[0].toLowerCase().includes('property')) { 
            lines.shift(); 
        }
        
        const inputRows = lines.map(line => { 
            const parts = line.split(","); 
            return { 
                propertyName: parts[0]?.trim() || "", 
                city: parts[1]?.trim() || "", 
                state: parts[2]?.trim() || "" 
            }; 
        });

        if (inputRows.length === 0) { alert("No valid rows found."); return; }

        resetAssetUI();
        updateAssetStatus("Fetching Master Asset List (handling pagination)...");

        try {
            const allAssets = await fetchAllAssets(apiKey, accountId);
            updateAssetStatus(`Master list obtained (${allAssets.length} assets). Processing ${inputRows.length} rows...`);
            
            // Allow UI to update before heavy processing
            await new Promise(r => setTimeout(r, 50));

            const matches = performMatching(inputRows, allAssets);
            
            renderResults(matches);
            assetResults = matches;

            updateAssetStatus(`✅ Bulk Process Complete. Processed ${matches.length} rows.`);
            document.getElementById('fuzzyCount').textContent = matches.length;

        } catch (error) { 
            console.error(error); 
            updateAssetStatus(`❌ Error: ${error.message}`); 
        }
    };

    reader.readAsText(file);
}

async function fetchAllAssets(apiKey, accountId) {
    let allAssets = [];
    let nextUrl = `https://api.sightmap.com/v1/accounts/${accountId}/assets?per-page=500`; 
    
    while (nextUrl) {
        const response = await fetch(nextUrl, { 
            method: 'GET', 
            headers: { 
                "API-Key": apiKey, 
                "Experimental-Flags": "accounts-assets" 
            } 
        });
        
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        
        const json = await response.json();
        const data = json.data || [];
        allAssets = allAssets.concat(data);
        
        nextUrl = json.paging ? json.paging.next_url : null;
        
        updateAssetStatus(`Fetching assets for Account ${accountId}... (Loaded ${allAssets.length})`);
        
        // Prevent UI freeze during large fetches
        await new Promise(r => setTimeout(r, 0));
    }
    return allAssets;
}

function performMatching(propertyRows, assets) {
    let matches = propertyRows.map(row => {
        const propName = normalize(row.propertyName);
        const propCity = normalize(row.city);
        const propState = normalize(row.state);
        
        let best = { score: 0, asset: null };
        
        for (let asset of assets) {
            const assetName = normalize(asset.name);
            const assetCity = normalize(asset.address_city || (asset.address ? asset.address.city : "")); 
            const assetState = normalize(asset.address_state || (asset.address ? asset.address.state : ""));
            
            const score = combinedScore(propName, assetName, propCity, assetCity, propState, assetState);
            
            if (score > best.score) best = { score, asset };
        }
        
        let label = "No match found", location = "", id = "";
        
        if (best.asset) {
            label = best.score >= 0.8 ? best.asset.name : `Guess: ${best.asset.name}`;
            
            const cityStr = best.asset.address_city || (best.asset.address ? best.asset.address.city : "") || "";
            const stateStr = best.asset.address_state || (best.asset.address ? best.asset.address.state : "") || "";
            
            location = (cityStr || stateStr) ? `${cityStr}, ${stateStr}` : "N/A";
            id = best.asset.id || "";
        }
        
        const scoreValue = best.score.toFixed(3);
        
        return { 
            propertyName: row.propertyName, 
            city: row.city, 
            state: row.state, 
            matchedName: label, 
            matchedLocation: location, 
            assetId: id, 
            score: scoreValue, 
            scoreStyle: scoreColor(scoreValue) 
        };
    });

    matches.sort((a, b) => {
        const rankDiff = scoreRank(b.score) - scoreRank(a.score);
        if (rankDiff !== 0) return rankDiff;
        return parseFloat(b.score) - parseFloat(a.score);
    });

    return matches;
}

// ... [Keep normalization/scoring helpers same as before] ...
function normalize(str) { if (!str) return ""; return str.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[.,'’"]/g, "").replace(/\s+/g, " ").trim().toLowerCase(); }
function levenshtein(a, b) { if (a === b) return 0; if (!a || !b) return Math.max(a.length, b.length); const v0 = new Array(b.length + 1); const v1 = new Array(b.length + 1); for (let i = 0; i <= b.length; i++) v0[i] = i; for (let i = 0; i < a.length; i++) { v1[0] = i + 1; for (let j = 0; j < b.length; j++) { const cost = a[i] === b[j] ? 0 : 1; v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost); } for (let j = 0; j <= b.length; j++) v0[j] = v1[j]; } return v1[b.length]; }
function similarity(a, b) { if (!a || !b) return 0; return 1 - levenshtein(a, b) / Math.max(a.length, b.length); }
function tokenMatchScore(a, b) { const t1 = new Set(normalize(a).split(" ")); const t2 = new Set(normalize(b).split(" ")); const inter = [...t1].filter(t => t2.has(t)); return inter.length / Math.max(t1.size, 1); }
function combinedScore(name1, name2, city1, city2, state1, state2) { const nameScore = similarity(name1, name2) * 0.6 + tokenMatchScore(name1, name2) * 0.4; const cityScore = similarity(city1, city2); const stateScore = state1 && state2 && state1 === state2 ? 1 : 0; return Math.min(1, nameScore * 0.7 + cityScore * 0.2 + stateScore * 0.1); }
function scoreRank(score) { const s = parseFloat(score); if (s >= 0.9) return 4; if (s >= 0.8) return 3; if (s >= 0.6) return 2; if (s > 0) return 1; return 0; }
function scoreColor(score) { const s = parseFloat(score); if (s >= 0.9) return "background-color:#22c55e;color:white;"; if (s >= 0.8) return "background-color:#eab308;color:black;"; if (s >= 0.6) return "background-color:#f97316;color:white;"; if (s > 0) return "background-color:#ef4444;color:white;"; return "background-color:#52525b;color:white;"; }

function renderResults(matches) {
    const tableBody = document.querySelector('#assetTable tbody');
    tableBody.innerHTML = ""; 
    matches.forEach(match => {
        const row = `<tr><td><span style="display:inline-block; padding:4px 8px; border-radius:4px; font-weight:bold; ${match.scoreStyle}">${match.score}</span></td><td style="color:#9ca3af; font-size:0.9em;">${match.propertyName}</td><td style="font-family:monospace; color:var(--accent-light);">${match.assetId}</td><td>${match.matchedName}</td><td>${match.matchedLocation}</td></tr>`;
        tableBody.insertAdjacentHTML('beforeend', row);
    });
}

function resetAssetUI() {
    assetResults = [];
    document.querySelector('#assetTable tbody').innerHTML = "";
    document.getElementById('assetProgressBar').style.width = "0%";
    document.getElementById('fuzzyCount').textContent = "0";
}

function updateAssetStatus(msg) { 
    document.getElementById('assetStatusMsg').textContent = msg; 
}

function downloadAssetCSV() { 
    if(assetResults.length === 0) { alert("No data to download"); return; } 
    let csvContent = "Input Name,Input City,Input State,Match Score,Matched Asset ID,Matched Asset Name,Matched Location\n"; 
    assetResults.forEach(r => { 
        const cleanName = r.propertyName.replace(/"/g, '""'); 
        const cleanMatchName = r.matchedName.replace(/"/g, '""'); 
        csvContent += `"${cleanName}","${r.city}","${r.state}",${r.score},${r.assetId},"${cleanMatchName}","${r.matchedLocation}"\n`; 
    }); 
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); 
    const link = document.createElement("a"); 
    const url = URL.createObjectURL(blob); 
    link.setAttribute("href", url); 
    link.setAttribute("download", "fuzzy_match_results.csv"); 
    document.body.appendChild(link); 
    link.click(); 
    document.body.removeChild(link); 
}

// NEW FUNCTION: Copy Table to Clipboard
function copyFuzzyTable() {
    if(assetResults.length === 0) { alert("No data"); return; }
    
    let text = "Score\tInput Name\tMatched ID\tMatched Name\tLocation\n";
    assetResults.forEach(r => {
        text += `${r.score}\t${r.propertyName}\t${r.assetId}\t${r.matchedName}\t${r.matchedLocation}\n`;
    });
    
    navigator.clipboard.writeText(text);
    alert("Table copied to clipboard!");
}