// app-helpers.js — čisté pomocné funkce dashboardu (bez DOM/stavu). Vytaženo z app.js
// kvůli testovatelnosti. V prohlížeči se načítá PŘED app.js/mixiny (globální funkce),
// v Node/testech přes module.exports. Jeden zdroj pravdy pro escapování (XSS obrana).
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
         .toString()
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

if (typeof module !== 'undefined' && module.exports) module.exports = { escapeHtml: escapeHtml };
