**Engrain SightMap API Data Explorer 🗺️**
  A powerful, browser-based utility for interacting with the Engrain SightMap API. This tool allows users to search, filter, match, and export asset data without writing code or using complex Postman collections.
  
  It runs entirely in the browser (client-side) and requires no backend server.

**🚀 Key Features**
  The application is divided into 8 specialized tabs, each designed for a specific data workflow:


**Unit Map Hunter**

  * Search for specific Map Styles (e.g., c, f.1, d) associated with an Asset ID.
  
  * Supports single lookup or Bulk CSV Upload.
  
  * Exports results to CSV or JSON.


**Asset List (Global)**

  * Fetches the entire list of allowed assets for the provided API Key.
  
  * Includes Local Filtering for City, State, and Tags.
  
  * Displays Asset ID, Name, Address, and Tags.


**Account Assets**

  * Scopes the asset search to a specific Account ID.
  
  * Features Dynamic Dropdown Filters that auto-populate based on the returned data.
  
  * Asset Matcher (Account Fuzzy)
  
  * Performs advanced fuzzy matching (Levenshtein distance + Token matching) against assets within a specific account.
  
  * Ideal for reconciling a messy list of property names against Engrain's database.
  
  * Returns a confidence score (0-100%) and color-coded results.


**Global Fuzzy Match**

  * Matches a Property Name + Address against the entire global database.
  
  * Does not require an Account ID.
  
  * Uses advanced address normalization (e.g., matching "St" to "Street").


**Asset Expenses**

  * Retrieves all expenses (fees, parking, pets) for a specific Asset ID.
  
  * Includes a Multi-Filter System to narrow down by Type, Category, or Frequency.
  
  * Displays required status and cost amounts/ranges.

**Reference Matcher**
  * Deep API Scanning: Performs a comprehensive scan by fetching the specific third-party reference data (e.g., Yardi, MRI, RealPage IDs) for every asset in the target list, ensuring high-accuracy   matching beyond just names.
  * Global vs. Local Search: Users can toggle between scanning a specific Account ID or running a Global search across the entire SightMap dataset.
  * Batch CSV Processing: Designed for reconciling external spreadsheets; users can upload a CSV with headers Reference ID and Property Name.
  * Actionable Reporting: Displays not just the match, but how it matched (Method), and lists all third-party keys associated with the found asset.

**Asset References**

  * Lists third-party integrations (e.g., Yardi, RealPage) mapped to an asset.
  
  * Returns the Reference ID, Key, and Value.


**Unit References**

  * Fetches specific Unit ID mappings for third-party systems.
  
  * Uses a 2-step process: First fetches Reference Groups, then iterates to find all unit keys.



**🛠️ Setup & Installation**
  This is a Static Web Application, meaning it requires no installation, no npm install, and no database.
  
  **Option to Run Locally**
  
  * Clone this repository:
  
    Bash command:
     _git clone https://github.com/YOUR_USERNAME/engrain-api-toolset.git_
  
  * Navigate to the folder.
  
  * Double-click index.html to open it in your browser.



**📂 Project Structure**
  * index.html - The main structure containing all tabs and UI elements.
  
  * styles.css - The "Cyberpunk/Navy" dark theme, animations, and responsive layout.
  
  * unitmap-search.js - Logic for Map Style searching.
  
  * asset-search.js - Logic for Account-scoped Fuzzy Matching.
  
  * global-fuzzy.js - Logic for Global Name+Address Matching.
  
  * asset-list.js - Logic for fetching the global asset list.
  
  * account-assets.js - Logic for fetching assets by Account ID.
  
  * asset-expenses.js - Logic for retrieving and filtering expenses.
  
  * asset-references.js - Logic for asset-level 3rd party refs.
  
  * unit-references.js - Logic for unit-level 3rd party refs.

**🔒 Security Note**
  * API Keys are NOT stored.
  
  * The key you paste into the input box is stored only in your browser's temporary memory (RAM) while the tab is open.
  
  * If you refresh the page, the key is cleared.
  
  * No data is sent to any server other than the official api.sightmap.com endpoints.

**📝 CSV Templates**
  Bulk upload features accept standard CSV files. You can download a pre-formatted template directly inside the tool for each section.

  **Common Headers:**

  * asset_id (for simple lookups)
  
  * Name, Address, City, State (for fuzzy matching)
