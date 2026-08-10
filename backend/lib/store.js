// --- store — datová vrstva ZA ROZHRANÍM (šev pro budoucí firemní režim) ---
// Dnes deleguje na JSON úložiště (database.js) → solo režim beze změny.
// Firemní/vícouživatelský režim vymění backend za SQLite (malá kancelář) nebo
// Postgres (více uživatelů, souběžné zápisy) implementací STEJNÉHO rozhraní,
// bez zásahu do business logiky. Výběr přes LEXIS_STORE (json|sqlite|postgres).
//
// KONTRAKT úložiště (každý backend musí nabídnout):
//   get(collection) -> array
//   set(collection, array) -> void
//   insert(collection, item) -> item (s id)
//   update(collection, id, updates) -> item | null
//   delete(collection, id) -> boolean
//   verifyLedger() -> { ok, ... }   (integrita auditního řetězce)
//
// Nová business logika by měla volat `store`, ne přímo `database`. Stávající kód
// dál funguje přes `database` (stejná data) — migrace je postupná, bez „big bang".

'use strict';

const backendName = (process.env.LEXIS_STORE || 'json').toLowerCase();

let backend;
switch (backendName) {
    // Firemní tier (zatím neimplementováno — sem se zapojí bez dotčení volajících):
    // case 'postgres': backend = require('./store/postgres'); break;
    // case 'sqlite':   backend = require('./store/sqlite');   break;
    case 'json':
    default:
        backend = require('./database'); // stávající šifrované JSON úložiště
        break;
}

module.exports = {
    name: backendName,
    get: (collection) => backend.get(collection),
    set: (collection, data) => backend.set(collection, data),
    insert: (collection, item) => backend.insert(collection, item),
    update: (collection, id, updates) => backend.update(collection, id, updates),
    delete: (collection, id) => backend.delete(collection, id),
    verifyLedger: () => backend.verifyLedger(),
    // Únikový poklop pro postupnou migraci / specifické operace backendu.
    _backend: backend
};
