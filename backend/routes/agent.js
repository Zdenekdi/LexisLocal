/**
 * routes/agent.js — volání jednoho AI agenta (RAG-obohacený prompt, anti-halucinační
 * strict režim, Green AI + transparency ledger, offline fallback).
 * Montuje se v server.js na /api/agent.
 */
'use strict';

const express = require('express');
const { CHAT_MODEL } = require('../lib/model_config');
const router = express.Router();
const crypto = require('crypto');
const { loadAgents } = require('../lib/agents');
const { searchSimilar } = require('../lib/rag');
const { anonymizeText } = require('../lib/anonymizer');
const { logEvent } = require('../lib/audit');
const { calculateInferenceMetrics } = require('../lib/green_monitor');
const db = require('../lib/database');
const ollama = require('../lib/ollama_client');
const { generateAgentFallback } = require('../lib/agent_fallback');
const { resolveRagFilters } = require('../lib/rag_request');

// POST /api/agent/:agentId - Volání agenta s modelem dle výběru
router.post('/:agentId', async (req, res) => {
    const { agentId } = req.params;
    const { prompt, context, model } = req.body;
    const startTime = Date.now();

    const agents = loadAgents();
    const agent = agents[agentId];
    if (!agent) {
        return res.status(404).json({ error: "Agent nebyl nalezen." });
    }

    // Choose model (default to llama3 if not specified)
    const selectedModel = model || CHAT_MODEL;
    console.log(`🤖 Volám agenta [${agent.name}] s modelem [${selectedModel}]`);

    // systemPromptText musí být viditelný i ve větvi catch (fallback loguje jeho hash).
    let systemPromptText = agent.systemPrompt;

    try {
        let resolvedFilters = null;
        try {
            resolvedFilters = await resolveRagFilters(req.body);
        } catch (fErr) {
            console.warn("⚠️ RAG: Selhalo rozlišení filtrů:", fErr.message);
        }

        const strictMode = resolvedFilters && (resolvedFilters.strict === true || resolvedFilters.strict === 'true');
        if (strictMode) {
            systemPromptText += "\n\n⚠️ ARCHITEKTURA PROTI HALUCINACÍM (STRICT RAG):\n" +
                "Jsi v režimu přísné shody s dokumentací. Odpovídej výhradně na základě poskytnutého schváleného kontextu ze spisů a kontextu dokumentu.\n" +
                "Pokud dodaný kontext neobsahuje odpověď na položenou otázku nebo zadání, nesmíš použít své obecné znalosti ani si nic domýšlet. " +
                "V takovém případě musí tvůj výstup začínat přesnou větou: 'Nedostatek podkladů ze spisů pro bezpečné vypracování.' a stručně uvést, co chybí.\n";
        }

        const messages = [
            { role: 'system', content: systemPromptText }
        ];

        // Retrieve relevant historical context from RAG memory
        let ragSources = [];
        try {
            if (resolvedFilters) {
                console.log(`🧠 RAG: Aktivní filtry pro vyhledávání: ${JSON.stringify(resolvedFilters)}`);
            }
            const matches = await searchSimilar(prompt, 3, resolvedFilters);
            const highConfidenceMatches = matches.filter(m => m.score >= 0.70);
            ragSources = highConfidenceMatches.map(m => ({
                fileName: m.fileName,
                score: m.score,
                textHash: crypto.createHash('sha256').update(m.text).digest('hex').substring(0, 8)
            }));

            if (highConfidenceMatches.length > 0) {
                const ragContextText = highConfidenceMatches
                    .map(m => `[Zdrojový spis: ${m.fileName}, Shoda: ${Math.round(m.score * 100)}%]:\n${m.text}`)
                    .join('\n\n---\n\n');

                messages.push({
                    role: 'system',
                    content: `Historický kontext a zjištěné precedenty z klientských spisů v archivu:\n${ragContextText}\n\nVýše uvedené historické pasáže a informace využij k přesnější argumentaci a přizpůsobení stylu, pokud je to vhodné.`
                });
                console.log(`🧠 RAG: Obohatil jsem systémovou zprávu agenta [${agent.name}] o ${highConfidenceMatches.length} sémantických pasáží.`);
            }
        } catch (ragErr) {
            console.warn("⚠️ RAG: Selhalo automatické sémantické vyhledávání pro agenta:", ragErr.message);
        }

        if (context) {
            const anonymizedContext = anonymizeText(context);
            messages.push({ role: 'system', content: `Kontext dokumentu / spisové podklady:\n${anonymizedContext}` });
        }

        messages.push({ role: 'user', content: prompt });

        const response = await ollama.chat({
            model: selectedModel,
            messages: messages,
            options: {
                temperature: 0.3
            }
        });

        const durationMs = Date.now() - startTime;
        logEvent('LexisEditor', `AI Agent (${agent.name})`, 'Generování textu', {
            model: selectedModel,
            promptLength: prompt.length,
            contextLength: context ? context.length : 0,
            responseLength: response.message.content.length,
            durationMs: durationMs
        });

        // 🌿 Green AI and 🔍 AI Act Transparency logs
        const greenMetrics = calculateInferenceMetrics(durationMs);
        db.insert('green_logs', {
            agentId,
            model: selectedModel,
            timestamp: new Date().toISOString(),
            ...greenMetrics
        });

        const systemPromptHash = crypto.createHash('sha256').update(systemPromptText).digest('hex');
        const transparencyRecord = db.insert('transparency_logs', {
            agentId,
            agentName: agent.name,
            model: selectedModel,
            prompt: prompt,
            systemPrompt: systemPromptText,
            systemPromptHash: systemPromptHash,
            ragSources: ragSources,
            timestamp: new Date().toISOString(),
            humanApproved: false,
            greenMetrics: {
                energyWh: greenMetrics.energyWh,
                co2Grams: greenMetrics.co2Grams
            }
        });

        res.json({
            agent: agent.name,
            model: selectedModel,
            response: response.message.content,
            transparencyId: transparencyRecord.id,
            greenMetrics,
            timestamp: new Date().toISOString()
        });

     } catch (err) {
        console.warn(`⚠️ Selhalo spojení s Ollama (${err.message}). Používám robustní lokální simulovaný fallback.`);
        const fallbackResponse = generateAgentFallback(agentId, prompt);
        const durationMs = Date.now() - startTime;

        logEvent('LexisEditor', `AI Agent Fallback (${agent.name})`, 'Generování textu (Fallback)', {
            model: `${selectedModel} (Simulovaný)`,
            promptLength: prompt.length,
            contextLength: context ? context.length : 0,
            responseLength: fallbackResponse.length,
            durationMs: durationMs
        });

        const greenMetrics = calculateInferenceMetrics(durationMs);
        db.insert('green_logs', {
            agentId,
            model: `${selectedModel} (Simulovaný)`,
            timestamp: new Date().toISOString(),
            ...greenMetrics
        });

        const systemPromptHash = crypto.createHash('sha256').update(systemPromptText).digest('hex');
        const transparencyRecord = db.insert('transparency_logs', {
            agentId,
            agentName: agent.name,
            model: `${selectedModel} (Simulovaný)`,
            prompt: prompt,
            systemPrompt: systemPromptText,
            systemPromptHash: systemPromptHash,
            ragSources: [],
            timestamp: new Date().toISOString(),
            humanApproved: false,
            greenMetrics: {
                energyWh: greenMetrics.energyWh,
                co2Grams: greenMetrics.co2Grams
            }
        });

        res.json({
            agent: agent.name,
            model: `${selectedModel} (Simulovaný)`,
            response: fallbackResponse,
            transparencyId: transparencyRecord.id,
            greenMetrics,
            timestamp: new Date().toISOString()
        });
     }
});

module.exports = router;
