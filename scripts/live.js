/**
 * scripts/live.js — ŽIVÝ test proti BĚŽÍCÍMU serveru s Ollamou (reálný AI výstup).
 * Spusť po `ollama serve` + `npm start`:  node scripts/live.js
 *
 * Bezpečné k datům: vytvoří jeden e-mailový úkol, VYPÍŠE reálný výstup agenta a
 * úkol zase SMAŽE. Schůzku jen KONTROLUJE (read-only), nic nerezervuje.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '127.0.0.1';
let TOKEN = process.env.API_TOKEN || '';
if (!TOKEN) { try { TOKEN = fs.readFileSync(path.join(os.homedir(), '.lexislocal', 'api_token'), 'utf8').trim(); } catch (e) {} }

function call(method, p, body, host, port) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const req = http.request({ host: host || HOST, port: port || PORT, path: p, method, headers: Object.assign(
            { 'X-API-Token': TOKEN }, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
        ) }, (res) => { let b = ''; res.on('data', c => b += c); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, body: j, raw: b }); }); });
        req.on('error', (e) => resolve({ status: 0, error: e.message }));
        if (data) req.write(data); req.end();
    });
}
const line = (s) => console.log(s);
const hr = () => line('─'.repeat(64));

(async () => {
    line('\n🟢 ŽIVÝ test LexisLocal (reálný AI výstup)\n');

    // 1) Server
    let r = await call('GET', '/api/status');
    if (r.status !== 200) { line('⛔ Server neběží na ' + HOST + ':' + PORT + '. Spusť `npm start`.\n'); process.exit(2); }
    line('✅ Backend běží (' + HOST + ':' + PORT + ')');

    // 2) Ollama + modely
    const tags = await call('GET', '/api/tags', null, '127.0.0.1', 11434);
    const models = (tags.body && tags.body.models || []).map(m => m.name);
    if (tags.status !== 200) { line('⛔ Ollama neběží (127.0.0.1:11434). Spusť `ollama serve`.\n'); process.exit(2); }
    line('✅ Ollama běží, modely: ' + (models.join(', ') || '(žádné!)'));
    const need = ['llama3', 'nomic-embed-text'];
    const missing = need.filter(n => !models.some(m => m.startsWith(n)));
    if (missing.length) line('⚠️  Chybí modely: ' + missing.join(', ') + '  → `ollama pull ' + missing.join('` a `ollama pull ') + '`');

    // 3) Autorizovaný odesílatel
    const set = await call('GET', '/api/email/settings');
    const sender = (set.body && set.body.settings && set.body.settings.authorized_sender) || 'advokat@dias.cz';
    line('ℹ️  Autorizovaný odesílatel: ' + sender);

    // 4) ŽIVÝ úkol pro Spisovatele (jeden agent → rychlejší) — reálný AI výstup
    hr();
    line('📝 Zadání: „[Spisovatel] Sepiš stručnou předžalobní výzvu k úhradě dlužné částky 15 000 Kč se splatností 14 dnů."');
    line('   (běží lokální AI — může chvíli trvat…)\n');
    const t0 = Date.now();
    r = await call('POST', '/api/email/process', {
        sender, subject: '[Spisovatel] Předžalobní výzva',
        body: 'Sepiš stručnou předžalobní výzvu k úhradě dlužné částky 15 000 Kč se splatností 14 dnů.'
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (r.status === 200 && r.body && r.body.success) {
        line('✅ Zpracováno za ' + secs + ' s  (režim: ' + r.body.mode + ')');
        const out = (r.body.task && r.body.task.responseSent) || '';
        hr(); line('VÝSTUP AGENTA:'); hr();
        line(out.length > 1600 ? out.slice(0, 1600) + '\n…(zkráceno)…' : out);
        hr();
        // úklid: smazat vytvořený úkol
        if (r.body.task && r.body.task.id) {
            const del = await call('DELETE', '/api/email/tasks/' + r.body.task.id);
            line(del.status === 200 ? '🧹 Testovací úkol smazán (úklid).' : '⚠️  Úklid úkolu se nezdařil (smaž ho ručně v záložce E-mail).');
        }
    } else if (r.status === 403) {
        line('❌ 403 — odesílatel se neshoduje s authorized_sender (' + sender + '). Uprav v testu nebo v nastavení.');
    } else {
        line('❌ Nezpracováno: ' + (r.body && r.body.error || r.status));
    }

    // 5) Kalendář — jen KONTROLA dostupnosti (nic nerezervuje)
    hr();
    const d = new Date(Date.now() + 86400000).toISOString().slice(0, 10); // zítra
    r = await call('POST', '/api/calendar/availability', { date: d, durationMin: 60, travelBufferMin: 30 });
    const slots = (r.body && r.body.freeSlots || []).map(s => s.start).slice(0, 10);
    line('📅 Volné termíny na ' + d + ' (60 min, rezerva 30 min): ' + (slots.join(', ') || '(žádné)'));

    line('\n🎉 Živý test dokončen. Pokud výstup agenta dává smysl, běží ti celý řetězec: e-mail → sekretářka → agent → odpověď.\n');
    process.exit(0);
})();
