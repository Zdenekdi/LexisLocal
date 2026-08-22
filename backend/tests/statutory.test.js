/**
 * Testy extrakce statutárního orgánu z ARES VR (registries.checkAresStatutory).
 * Mockovaný fetch, žádná síť. Rekurzivní extrakce tolerantní k zanoření; fail-closed.
 */
'use strict';

const path = require('path');
const os = require('os');
process.env.WATCH_DIR = path.join(os.tmpdir(), `lexis_test_stat_${Date.now()}`);
process.env.LEXIS_KEY_DIR = path.join(os.tmpdir(), `lexis_test_stat_key_${Date.now()}`);

const r = require('../lib/registries');

const VR = {
    icoId: '123',
    zaznamy: [{
        obchodniJmeno: [{ hodnota: 'Firma s.r.o.' }],
        statutarniOrgan: [{
            typOrganu: 'jednatel',
            clenoveOrganu: [
                { fyzickaOsoba: { jmeno: 'Petr', prijmeni: 'Svoboda' }, clenstvi: { funkce: { nazev: 'jednatel' } } },
                { fyzickaOsoba: { jmeno: 'Eva', prijmeni: 'Nováková' }, clenstvi: { funkce: { nazev: 'jednatelka' } } }
            ],
            zpusobJednani: [{ zpusobJednani: 'Každý jednatel jedná samostatně.' }]
        }]
    }]
};

describe('ARES VR statutární orgán', () => {
    test('extrahuje členy i způsob jednání', async () => {
        const res = await r.checkAresStatutory('45274649', { fetchUrl: async () => JSON.stringify(VR) });
        expect(res.available).toBe(true);
        expect(res.members.length).toBe(2);
        expect(res.members.some(m => m.prijmeni === 'Svoboda' && m.funkce === 'jednatel')).toBe(true);
        expect(res.zpusobJednani).toContain('Každý jednatel jedná samostatně.');
    });

    test('neplatné IČO → available:false', async () => {
        expect((await r.checkAresStatutory('123')).available).toBe(false);
    });

    test('výpadek sítě → available:false, žádní členové (fail-closed)', async () => {
        const res = await r.checkAresStatutory('45274649', { fetchUrl: async () => { throw new Error('down'); } });
        expect(res.available).toBe(false);
        expect(res.members).toBeUndefined();
    });
});
