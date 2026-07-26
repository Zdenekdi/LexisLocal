/**
 * Testy Mutex (../lib/mutex.js) — jednoduchý async zámek s FIFO frontou.
 */

const Mutex = require('../lib/mutex');

describe('Mutex', () => {
    test('acquire na odemčeném projde okamžitě a zamkne', async () => {
        const m = new Mutex();
        await m.acquire();
        expect(m.locked).toBe(true);
    });

    test('druhý acquire čeká, dokud první nepustí', async () => {
        const m = new Mutex();
        await m.acquire();
        let second = false;
        const p = m.acquire().then(() => { second = true; });
        // ještě nepuštěno → druhý stále čeká
        await Promise.resolve();
        expect(second).toBe(false);
        m.release();
        await p;
        expect(second).toBe(true);
    });

    test('serializuje souběžný přístup ke sdílenému stavu (FIFO)', async () => {
        const m = new Mutex();
        const order = [];
        async function critical(id) {
            await m.acquire();
            order.push('start' + id);
            await new Promise(r => setTimeout(r, 5));
            order.push('end' + id);
            m.release();
        }
        await Promise.all([critical(1), critical(2), critical(3)]);
        // Nikdy se nepřekříží: každý start je hned následován svým end.
        expect(order).toEqual(['start1', 'end1', 'start2', 'end2', 'start3', 'end3']);
    });

    test('release bez fronty jen odemkne', async () => {
        const m = new Mutex();
        await m.acquire();
        m.release();
        expect(m.locked).toBe(false);
        await expect(m.acquire()).resolves.toBeUndefined(); // dá se znovu získat
    });
});
