#!/usr/bin/env node
/**
 * scripts/readiness.js — POCTIVÝ diagnostický report reálného stavu LexisLocal.
 * Nic nepředstírá: spustí konkrétní kontroly a řekne READY / ČÁSTEČNĚ / NENÍ.
 * Cílem je, aby tvrzení o zralosti šla ověřit příkazem, ne slibem.
 *
 *   node backend/scripts/readiness.js        (nebo: npm run readiness)
 */
'use strict';

const path = require('path');
let ai, rag, agents;
try { ai = require('../lib/ai_provider'); } catch (e) {}
try { rag = require('../lib/rag'); } catch (e) {}
try { agents = require('../lib/agents'); } catch (e) {}

const R = { ok: '✅ READY', part: '🟡 ČÁSTEČNĚ', no: '❌ NENÍ' };
const lines = [];
function say(status, area, detail) { lines.push({ status, area, detail }); }

async function main() {
    // 1) Node + závislosti
    const major = parseInt(process.versions.node.split('.')[0], 10);
    say(major >= 18 ? R.ok : R.part, 'Node.js', `v${process.versions.node}`);

    // 2) AI poskytovatel + dosažitelnost embedding modelu (probe)
    const info = ai && ai.providerInfo ? ai.providerInfo() : { chat: '?', embed: '?' };
    let embedOk = false, embedErr = '';
    if (rag && rag.getEmbedding) {
        try { const v = await rag.getEmbedding('test'); embedOk = Array.isArray(v) && v.length > 0; }
        catch (e) { embedErr = e.message; }
    }
    say(embedOk ? R.ok : R.no, 'Embedding model',
        `poskytovatel: ${info.embed}; ${embedOk ? 'dosažitelný (vektory OK)' : 'NEDOSAŽITELNÝ — RAG běží jen lexikálně (' + (embedErr || 'bez modelu') + ')'}`);
    say(R.part, 'Chat model', `poskytovatel: ${info.chat} (dosažitelnost neověřuji — probe jen u embeddingu)`);

    // 3) Znalostní báze agentů (per-agent RAG)
    if (agents && rag && rag.listKnowledge && agents.loadAgents) {
        const a = agents.loadAgents();
        let filled = 0, total = 0, docs = 0;
        for (const id of Object.keys(a)) {
            total++;
            try { const d = rag.listKnowledge(a[id].knowledgeScope) || []; if (d.length) filled++; docs += d.length; } catch (e) {}
        }
        say(filled === 0 ? R.no : (filled < total ? R.part : R.ok), 'Znalostní báze agentů',
            `${filled}/${total} agentů naplněno, celkem ${docs} dokumentů`);
    } else { say(R.no, 'Znalostní báze agentů', 'modul nedostupný'); }

    // 4) Klientský RAG index
    if (rag && rag.loadIndex) {
        try {
            const idx = await rag.loadIndex();
            const files = new Set((idx.chunks || []).map(c => c.fileName));
            say(files.size === 0 ? R.part : R.ok, 'Klientský RAG index', `${files.size} dokumentů, ${(idx.chunks || []).length} chunků`);
        } catch (e) { say(R.no, 'Klientský RAG index', e.message); }
    }

    // 5) Runtime ověření (nelze z CLI) — poctivě označit jako neověřené
    say(R.part, 'Runtime ověření (E2E)', 'export do Wordu / odeslání datovkou / OCR — nutno ověřit v běžící aplikaci, ne unit testy');

    // Výpis
    console.log('\n=== LexisLocal — readiness report ===\n');
    for (const l of lines) console.log(`  ${l.status.padEnd(14)} ${l.area}\n                 ${l.detail}`);
    const noCount = lines.filter(l => l.status === R.no).length;
    const partCount = lines.filter(l => l.status === R.part).length;
    console.log(`\n  Souhrn: ${lines.length - noCount - partCount} ready, ${partCount} částečně, ${noCount} chybí.`);
    console.log('  (Report je popis reálného stavu, ne marketingové tvrzení.)\n');
}
main().catch(e => { console.error('Readiness selhal:', e.message); process.exit(1); });
