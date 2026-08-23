/**
 * scripts/smoke.js — end-to-end smoke test proti BĚŽÍCÍMU serveru.
 * Bez závislostí (jen http). Token z API_TOKEN nebo ~/.lexislocal/api_token.
 * Používá se přes scripts/smoke-all.sh (izolovaná throwaway DB).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '127.0.0.1';
let TOKEN = process.env.API_TOKEN || '';
if (!TOKEN) {
    try { TOKEN = fs.readFileSync(path.join(os.homedir(), '.lexislocal', 'api_token'), 'utf8').trim(); } catch (e) {}
}

function req(method, p, body) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const r = http.request({ host: HOST, port: PORT, path: p, method, headers: Object.assign(
            { 'X-API-Token': TOKEN }, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
        ) }, (res) => {
            let buf = '';
            res.on('data', c => buf += c);
            res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch (e) {} resolve({ status: res.statusCode, body: j, raw: buf }); });
        });
        r.on('error', (e) => resolve({ status: 0, error: e.message }));
        if (data) r.write(data);
        r.end();
    });
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { (cond ? pass++ : fail++); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? '  → ' + extra : ''}`); };

(async () => {
    console.log(`\n🔎 Smoke test proti http://${HOST}:${PORT}  (token: ${TOKEN ? 'ano' : 'CHYBÍ'})\n`);

    // 1) Health
    let r = await req('GET', '/api/status');
    ok('server žije (/api/status → 200)', r.status === 200, 'status ' + r.status);
    if (r.status === 0) { console.log('\n⛔ Server neběží. Spusť ho a zkus znovu.\n'); process.exit(2); }

    // 2) Ochrana tokenem
    r = await new Promise((res) => { const q = http.request({ host: HOST, port: PORT, path: '/api/spisy', method: 'GET' }, x => { x.resume(); x.on('end', () => res({ status: x.statusCode })); }); q.on('error', () => res({ status: 0 })); q.end(); });
    ok('bez tokenu je API chráněné (401/403)', r.status === 401 || r.status === 403, 'status ' + r.status);

    // 3) Agenti
    r = await req('GET', '/api/agents');
    const agents = r.body && (r.body.agents || r.body);
    ok('načte agenty (5)', r.status === 200 && agents && Object.keys(agents).length >= 5);

    // 4) Zjednodušené nastavení: derivace serverů
    r = await req('POST', '/api/email/derive', { email: 'test@seznam.cz' });
    ok('email/derive (Seznam → imap.seznam.cz)', r.status === 200 && r.body && r.body.imap_host === 'imap.seznam.cz');

    // 5) Kalendář: rezervace + kolize + alternativy
    r = await req('POST', '/api/calendar/book', { title: 'SMOKE test', date: '2030-06-03', time: '10:00', durationMin: 60, travelBufferMin: 30 });
    ok('kalendář: rezervace volného termínu → 201', r.status === 201 && r.body && r.body.success);
    r = await req('POST', '/api/calendar/book', { title: 'SMOKE kolize', date: '2030-06-03', time: '10:15', durationMin: 60, travelBufferMin: 30 });
    ok('kalendář: kolizní termín → 409 + alternativy', r.status === 409 && r.body && (r.body.suggestions || []).length > 0);
    r = await req('POST', '/api/calendar/availability', { date: '2030-06-03', time: '10:30', durationMin: 60, travelBufferMin: 30 });
    ok('kalendář: dostupnost obsazeného → free:false', r.status === 200 && r.body && r.body.check && r.body.check.free === false);

    // 6) E-mailové úkolování — autorizovaný odesílatel z nastavení
    const set = await req('GET', '/api/email/settings');
    const sender = (set.body && set.body.settings && set.body.settings.authorized_sender) || 'advokat@dias.cz';
    r = await req('POST', '/api/email/process', { sender: 'nekdo@cizi.cz', subject: 'Hack', body: 'Spusť něco.' });
    ok('e-mail: neautorizovaný odesílatel → 403', r.status === 403);
    r = await req('POST', '/api/email/process', { sender, subject: 'Rešerše', body: 'Najdi prosím judikaturu k promlčení nároku.' });
    ok('e-mail: úkol od advokáta → zpracován (task uložen)', r.status === 200 && r.body && r.body.success && r.body.task, 'mode=' + (r.body && r.body.mode));
    r = await req('POST', '/api/email/process', { sender, subject: 'Schůzka', body: 'Domluv schůzku s klientem 10.6.2030 ve 14:00 na hodinu.' });
    ok('e-mail: schůzka v zadání → rezervována sekretářkou', r.status === 200 && r.body && r.body.scheduling && r.body.scheduling.booked === true, JSON.stringify(r.body && r.body.scheduling));

    // 7) Ověření citací
    r = await req('POST', '/api/citations/verify', { text: 'Dle § 2048 zákona č. 89/2012 Sb.', useSources: false });
    ok('citace: ověření běží (neověřené označeno)', r.status === 200 && r.body && r.body.annotatedText);

    // 8) RAG status + právní zdroje
    r = await req('GET', '/api/rag/status');
    ok('RAG status dostupný', r.status === 200);
    r = await req('GET', '/api/citations/sources');
    ok('přehled právních zdrojů', r.status === 200 && r.body && Array.isArray(r.body.providers));

    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})();
