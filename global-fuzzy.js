let globalFuzzyResults = [];
let cachedGlobalAssets = [];

document.addEventListener('DOMContentLoaded', () => {
    // Buttons
    document.getElementById('runGlobalFuzzyBtn').addEventListener('click', runSingleGlobalFuzzy);
    document.getElementById('bulkGlobalFuzzyBtn').addEventListener('click', runBulkGlobalFuzzy);
    document.getElementById('downloadGfBtn').addEventListener('click', downloadGfCSV);
    
    // NEW: Copy to Clipboard Button
    const copyClipBtn = document.getElementById('copyGfClipBtn');
    if (copyClipBtn) copyClipBtn.addEventListener('click', copyGfTable);

    // Template Link
    document.getElementById('gfTemplateLink').addEventListener('click', (e) => {
        e.preventDefault();
        const csvContent = "Name,Address,City,State\nThe Lofts,100 Main St,Denver,CO\nSunrise Apts,555 Broad Ave,Austin,TX";
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", "global_fuzzy_template.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
});

async function runSingleGlobalFuzzy() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const name = document.getElementById('gfName').value.trim();
    const address = document.getElementById('gfAddress').value.trim();
    const city = document.getElementById('gfCity').value.trim();
    const state = document.getElementById('gfState').value.trim();
    
    if (!apiKey) { alert("Please enter API Key."); return; }
    if (!name) { alert("Please enter a Property Name."); return; }

    resetGfUI();
    updateGfStatus("Fetching Global Asset List (this may take a moment)...");

    try {
        const assets = await getGlobalAssets(apiKey);
        updateGfStatus(`Scanning ${assets.length} global assets...`);

        // Small pause to ensure UI renders
        await new Promise(r => setTimeout(r, 50));

        const inputRows = [{ propertyName: name, address: address, city: city, state: state }];
        
        // Use Async Matching
        const matches = await performGlobalMatchingAsync(inputRows, assets);

        renderGfResults(matches);
        globalFuzzyResults = matches;
        
        if(matches[0].score > 0.8) {
            updateGfStatus(`✅ Strong match found: ${matches[0].matchedAssetName}`);
        } else {
            updateGfStatus("⚠️ Analysis complete. Check results for best guess.");
        }
        
        document.getElementById('gfCount').textContent = matches.length;

    } catch (error) {
        console.error(error);
        updateGfStatus(`❌ Error: ${error.message}`);
    }
}

async function runBulkGlobalFuzzy() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const fileInput = document.getElementById('gfCsvFile');

    if (!apiKey) { alert("Please enter API Key."); return; }
    if (fileInput.files.length === 0) { alert("Please select a CSV."); return; }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async function(e) {
        const csvText = e.target.result;
        const inputRows = parseGfCSV(csvText);

        if (inputRows.length === 0) { alert("No valid rows found."); return; }

        resetGfUI();
        updateGfStatus("Fetching Global Asset List...");

        try {
            const assets = await getGlobalAssets(apiKey);
            updateGfStatus(`Scanning ${assets.length} assets against ${inputRows.length} inputs...`);

            // Use Async/Chunked Matching
            const matches = await performGlobalMatchingAsync(inputRows, assets);

            renderGfResults(matches);
            globalFuzzyResults = matches;

            updateGfStatus(`✅ Bulk Process Complete. Processed ${matches.length} rows.`);
            document.getElementById('gfCount').textContent = matches.length;

        } catch (error) {
            console.error(error);
            updateGfStatus(`❌ Error: ${error.message}`);
        }
    };

    reader.readAsText(file);
}

// ==========================================
// API LOGIC (Optimized w/ Yielding)
// ==========================================
async function getGlobalAssets(apiKey) {
    if (cachedGlobalAssets.length > 0) return cachedGlobalAssets;

    let assets = [];
    let nextUrl = `https://api.sightmap.com/v1/assets?per-page=500`; 
    let pageCount = 0;

    while (nextUrl) {
        const response = await fetch(nextUrl, {
            method: 'GET',
            headers: { "API-Key": apiKey }
        });
        
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        
        const json = await response.json();
        const data = json.data || [];
        
        for (const item of data) {
            assets.push(item);
        }

        nextUrl = json.paging ? json.paging.next_url : null;
        
        pageCount++;
        // Fake visual progress
        const fakeProgress = Math.min((pageCount * 10), 90); 
        document.getElementById('gfProgressBar').style.width = `${fakeProgress}%`;
        
        updateGfStatus(`Fetching global database... (Loaded ${assets.length} assets)`);
        
        // CRITICAL: Yield to main thread to allow UI to update
        await new Promise(r => setTimeout(r, 0));
    }

    document.getElementById('gfProgressBar').style.width = "100%";
    cachedGlobalAssets = assets;
    return assets;
}

// ==========================================
// ASYNC MATCHING (Fixes "Page Unresponsive")
// ==========================================
async function performGlobalMatchingAsync(inputRows, assets) {
    let matches = [];
    const CHUNK_SIZE = 20; // Process 20 rows at a time
    
    for (let i = 0; i < inputRows.length; i += CHUNK_SIZE) {
        const chunk = inputRows.slice(i, i + CHUNK_SIZE);
        
        // Process this chunk synchronously
        const chunkMatches = chunk.map(row => matchSingleRow(row, assets));
        matches = matches.concat(chunkMatches);

        // Update Progress Bar
        const progress = Math.round(((i + chunk.length) / inputRows.length) * 100);
        document.getElementById('gfProgressBar').style.width = `${progress}%`;
        updateGfStatus(`Matching... (${i + chunk.length}/${inputRows.length})`);

        // Yield to browser
        await new Promise(r => setTimeout(r, 0));
    }

    // Sort Results
    matches.sort((a, b) => {
        const addrDiff = parseFloat(b.addressMatch) - parseFloat(a.addressMatch);
        if (Math.abs(addrDiff) > 0.0001) return addrDiff;
        return parseFloat(b.score) - parseFloat(a.score);
    });

    return matches;
}

function matchSingleRow(row, assets) {
    let bestMatch = null;
    let bestScore = 0;
    let bestAddrScore = 0;

    const propNameNorm = normalize(row.propertyName);
    const propAddrNorm = normalize(row.address);

    for (let asset of assets) {
        if (!asset.name) continue;

        const assetNameNorm = normalize(asset.name);
        const assetAddrNorm = normalize(asset.address_line1 || "");

        const score = combinedScore(propNameNorm, assetNameNorm, propAddrNorm, assetAddrNorm);
        const addrSim = levenshteinSimilarity(propAddrNorm, assetAddrNorm);

        if (score > bestScore) {
            bestScore = score;
            bestAddrScore = addrSim;
            bestMatch = asset;
        }
    }

    let matchedAssetName = "No match found";
    let matchedAssetAddr = "";
    let matchedAssetId = "";
    let matchedAssetCity = "";
    let matchedAssetState = "";
    let scoreColor = "background-color:var(--col-slate);color:white;";

    if (bestMatch) {
        matchedAssetId = bestMatch.id;
        matchedAssetAddr = bestMatch.address_line1 || "";
        matchedAssetCity = bestMatch.address_city || "";
        matchedAssetState = bestMatch.address_state || "";
        
        if (bestScore >= 0.85) {
            matchedAssetName = bestMatch.name;
            scoreColor = "background-color:#059669;color:white;"; 
        } else if (bestScore >= 0.6) {
            matchedAssetName = `Guess: ${bestMatch.name}`;
            scoreColor = "background-color:#d97706;color:white;";
        } else {
            matchedAssetName = `Weak: ${bestMatch.name}`;
            scoreColor = "background-color:#b91c1c;color:white;";
        }
    }

    return {
        propertyName: row.propertyName,
        address: row.address,
        city: row.city || "",
        state: row.state || "",
        matchedAssetName,
        matchedAssetAddr,
        matchedAssetCity,
        matchedAssetState,
        matchedAssetId,
        score: bestScore.toFixed(3),
        addressMatch: bestAddrScore.toFixed(3),
        scoreStyle: scoreColor
    };
}

// ... [Keep normalization/scoring helpers] ...
const abbreviationMap = {
    "n": "north", "n.": "north", "s": "south", "s.": "south",
    "e": "east", "e.": "east", "w": "west", "w.": "west",
    "st": "street", "st.": "street", "rd": "road", "rd.": "road",
    "ave": "avenue", "ave.": "avenue", "blvd": "boulevard", "blvd.": "boulevard",
    "ln": "lane", "ln.": "lane", "dr": "drive", "dr.": "drive",
    "ct": "court", "ct.": "court", "pl": "place", "pl.": "place",
    "sq": "square", "sq.": "square", "pkwy": "parkway", "cir": "circle",
    "apt": "apartment", "bldg": "building", "unit": "unit"
};

function normalize(str) {
    if (!str) return "";
    str = str.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[.,'’"]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    let words = str.split(" ");
    const result = [];
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const next = words[i + 1];
        const combined = `${w} ${next}`;
        if (abbreviationMap[combined]) { result.push(abbreviationMap[combined]); i++; } else { result.push(abbreviationMap[w] || w); }
    }
    return result.join(" ");
}

function levenshteinSimilarity(a, b) {
    if (!a || !b) return 0;
    const len = Math.max(a.length, b.length);
    if (len === 0) return 1.0;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
    for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) == a.charAt(j - 1)) { matrix[i][j] = matrix[i - 1][j - 1]; } else { matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)); }
        }
    }
    return 1 - (matrix[b.length][a.length] / len);
}

function tokenMatchScore(str1, str2) {
    const tokens1 = new Set(normalize(str1).split(" "));
    const tokens2 = new Set(normalize(str2).split(" "));
    const matches = [...tokens1].filter(t => tokens2.has(t)).length;
    return matches / Math.max(tokens1.size, 1);
}

function numberMatchBonus(a, b) {
    const numsA = (a.match(/\d+/g) || []);
    const numsB = (b.match(/\d+/g) || []);
    const matches = numsA.filter(n => numsB.includes(n)).length;
    return matches > 0 ? 0.1 : 0;
}

function combinedScore(propName, assetName, propAddr, assetAddr) {
    const nameLev = levenshteinSimilarity(propName, assetName);
    const nameToken = tokenMatchScore(propName, assetName);
    const addrLev = levenshteinSimilarity(propAddr, assetAddr);
    const addrToken = tokenMatchScore(propAddr, assetAddr);
    const numBonus = numberMatchBonus(propAddr, assetAddr);
    return Math.min(1, (nameLev * 0.4) + (nameToken * 0.3) + (addrLev * 0.2) + (addrToken * 0.1) + numBonus);
}

function parseGfCSV(csvText) {
    const lines = csvText.split(/\r\n|\n/).filter(line => line.trim() !== "");
    if (lines[0].toLowerCase().includes('name') || lines[0].toLowerCase().includes('address')) {
        lines.shift();
    }
    return lines.map(line => {
        const parts = line.split(',');
        return {
            propertyName: parts[0] ? parts[0].trim() : "",
            address: parts[1] ? parts[1].trim() : "",
            city: parts[2] ? parts[2].trim() : "",
            state: parts[3] ? parts[3].trim() : ""
        };
    });
}

function renderGfResults(matches) {
    const tableBody = document.querySelector('#gfTable tbody');
    tableBody.innerHTML = ""; 
    matches.forEach(match => {
        const row = `<tr><td><span class="match-tag" style="${match.scoreStyle} border:none;">${match.score}</span></td><td>${match.propertyName}</td><td>${match.address}</td><td>${match.city}</td><td>${match.state}</td><td style="font-family:monospace; color:var(--accent-light);">${match.matchedAssetId}</td><td style="font-weight:600;">${match.matchedAssetName}</td><td>${match.matchedAssetAddr}</td><td>${match.matchedAssetCity}</td><td>${match.matchedAssetState}</td></tr>`;
        tableBody.insertAdjacentHTML('beforeend', row);
    });
    document.getElementById('gfCount').textContent = matches.length;
}

function resetGfUI() {
    globalFuzzyResults = [];
    document.querySelector('#gfTable tbody').innerHTML = "";
    document.getElementById('gfProgressBar').style.width = "0%";
    document.getElementById('gfCount').textContent = "0";
}

function updateGfStatus(msg) {
    document.getElementById('gfStatusMsg').textContent = msg;
}

function downloadGfCSV() {
    if(globalFuzzyResults.length === 0) { alert("No data"); return; }
    let csvContent = "Input_Name,Input_Address,Input_City,Input_State,Match_Score,Matched_ID,Matched_Name,Matched_Address,Matched_City,Matched_State\n";
    globalFuzzyResults.forEach(r => {
        const iName = (r.propertyName || "").replace(/"/g, '""');
        const iAddr = (r.address || "").replace(/"/g, '""');
        const iCity = (r.city || "").replace(/"/g, '""');
        const iState = (r.state || "").replace(/"/g, '""');
        const mName = (r.matchedAssetName || "").replace(/"/g, '""');
        const mAddr = (r.matchedAssetAddr || "").replace(/"/g, '""');
        const mCity = (r.matchedAssetCity || "").replace(/"/g, '""');
        const mState = (r.matchedAssetState || "").replace(/"/g, '""');
        csvContent += `"${iName}","${iAddr}","${iCity}","${iState}",${r.score},${r.matchedAssetId},"${mName}","${mAddr}","${mCity}","${mState}"\n`;
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "global_fuzzy_matches.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// NEW FUNCTION: Copy Table to Clipboard (TSV)
function copyGfTable() {
    if(globalFuzzyResults.length === 0) { alert("No data"); return; }
    
    let text = "Score\tInput Name\tInput Address\tInput City\tInput State\tMatched ID\tMatched Name\tMatched Address\tMatched City\tMatched State\n";
    globalFuzzyResults.forEach(r => {
        text += `${r.score}\t${r.propertyName}\t${r.address}\t${r.city}\t${r.state}\t${r.matchedAssetId}\t${r.matchedAssetName}\t${r.matchedAssetAddr}\t${r.matchedAssetCity}\t${r.matchedAssetState}\n`;
    });
    
    navigator.clipboard.writeText(text);
    alert("Table copied to clipboard!");
}