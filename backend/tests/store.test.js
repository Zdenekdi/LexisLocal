/**
 * Testy store.js — datová vrstva za rozhraním. Ověřuje, že výchozí backend je JSON
 * a že delegace (insert/get) funguje. Firemní režim vymění backend beze změny API.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.WATCH_DIR = path.join(os.tmpdir(), `lexis_store_${Date.now()}`);
fs.mkdirSync(process.env.WATCH_DIR, { recursive: true });

const store = require('../lib/store');

describe('store (výchozí JSON backend)', () => {
    test('výchozí backend je json a nabízí kontraktní metody', () => {
        expect(store.name).toBe('json');
        ['get', 'set', 'insert', 'update', 'delete', 'verifyLedger'].forEach(m =>
            expect(typeof store[m]).toBe('function'));
    });

    test('insert → get round-trip přes fasádu', () => {
        const rec = store.insert('unittest_store', { foo: 'bar' });
        expect(rec.id).toBeDefined();
        const all = store.get('unittest_store');
        expect(all.some(x => x.id === rec.id && x.foo === 'bar')).toBe(true);
    });
});
