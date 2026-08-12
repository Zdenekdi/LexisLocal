/**
 * routes/email.js — nastavení IMAP/SMTP, e-mailové úkoly a simulace příchozího
 * e-mailu od advokáta (výběr asistenta + vygenerování odpovědi).
 * Montuje se v server.js na /api/email.
 */
'use strict';

const express = require('express');
const { CHAT_MODEL } = require('../lib/model_config');
const router = express.Router();
const db = require('../lib/database');
const { logEvent } = require('../lib/audit');
const { loadAgents } = require('../lib/agents');
const ollama = require('../lib/ollama_client');
const { generateAgentFallback } = require('../lib/agent_fallback');

// GET /api/email/settings - Načíst nastavení IMAP/SMTP a autorizovaného odesílatele
router.get('/settings', (req, res) => {
    try {
        const settingsList = db.get('email_settings') || [];
        const currentSettings = settingsList.length > 0 ? settingsList[0] : {
            authorized_sender: 'advokat@dias.cz',
            recipient_filter: 'dias+asistenti@advokatnikancelar.cz',
            imap_host: 'imap.advokatnikancelar.cz',
            imap_port: '993',
            imap_user: 'dias@advokatnikancelar.cz',
            imap_ssl: true,
            smtp_host: 'smtp.advokatnikancelar.cz',
            smtp_port: '465',
            smtp_user: 'dias@advokatnikancelar.cz',
            smtp_ssl: true
        };
        res.json({ success: true, settings: currentSettings });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst nastavení e-mailu: ${err.message}` });
    }
});

// POST /api/email/settings - Uložit nastavení
router.post('/settings', (req, res) => {
    try {
        const newSettings = req.body;
        const settingsList = db.get('email_settings') || [];
        if (settingsList.length > 0) {
            db.update('email_settings', settingsList[0].id, newSettings);
        } else {
            db.insert('email_settings', newSettings);
        }
        logEvent('LexisLocal Dashboard', 'Uložení nastavení e-mailu', 'AI Konfigurace');
        res.json({ success: true, message: "Nastavení e-mailu bylo uloženo." });
    } catch (err) {
        res.status(500).json({ error: `Nelze uložit nastavení e-mailu: ${err.message}` });
    }
});

// GET /api/email/tasks - Seznam všech doručených/zpracovaných úkolů
router.get('/tasks', (req, res) => {
    try {
        const tasks = db.get('email_tasks') || [];
        const sorted = [...tasks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ success: true, tasks: sorted });
    } catch (err) {
        res.status(500).json({ error: `Nelze načíst e-mailové úkoly: ${err.message}` });
    }
});

// DELETE /api/email/tasks/:id - Smazat úkol z historie
router.delete('/tasks/:id', (req, res) => {
    const { id } = req.params;
    try {
        db.delete('email_tasks', id);
        logEvent('LexisLocal Dashboard', 'Smazání e-mailového úkolu', 'E-mailové úkoly', { id });
        res.json({ success: true, message: "E-mailový úkol byl smazán." });
    } catch (err) {
        res.status(500).json({ error: `Nelze smazat úkol: ${err.message}` });
    }
});

// POST /api/email/simulate - Simulace příchozího e-mailu od advokáta
router.post('/simulate', async (req, res) => {
    const { sender, subject, body } = req.body;

    if (!sender || !subject || !body) {
        return res.status(400).json({ error: "Odesílatel, předmět a obsah e-mailu jsou povinné." });
    }

    try {
        // 1. Ověření autorizovaného odesílatele
        const settingsList = db.get('email_settings') || [];
        const settings = settingsList.length > 0 ? settingsList[0] : {
            authorized_sender: 'advokat@dias.cz'
        };

        if (settings && settings.authorized_sender) {
            const cleanSender = sender.trim().toLowerCase();
            const cleanAuthorized = settings.authorized_sender.trim().toLowerCase();
            if (cleanSender !== cleanAuthorized) {
                return res.status(403).json({
                    error: `❌ Přístup odepřen: Odesílatel "${sender}" není autorizovaným e-mailem advokáta (${settings.authorized_sender}).`
                });
            }
        }

        // 2. Výběr příslušného asistenta
        const agents = loadAgents();
        let selectedAgentId = null;

        // A. Detekce podle předmětu v hranatých závorkách (např. [Spisovatel] nebo [Kontrolor])
        const subjectMatch = subject.match(/\[([^\]]+)\]/);
        if (subjectMatch) {
            const agentNameOrId = subjectMatch[1].trim().toLowerCase();
            const foundAgent = Object.values(agents).find(a =>
                a.id.toLowerCase() === agentNameOrId ||
                a.name.toLowerCase() === agentNameOrId
            );
            if (foundAgent) {
                selectedAgentId = foundAgent.id;
            }
        }

        // B. Detekce podle tagu na začátku těla zprávy (např. @kontrolor nebo @spisovatel)
        if (!selectedAgentId) {
            const bodyMention = body.trim().match(/^@([a-zA-Z0-9_ěščřžýáíéúůóďťňĎŤŇ]+)/);
            if (bodyMention) {
                const agentNameOrId = bodyMention[1].trim().toLowerCase();
                const foundAgent = Object.values(agents).find(a =>
                    a.id.toLowerCase() === agentNameOrId ||
                    a.name.toLowerCase() === agentNameOrId
                );
                if (foundAgent) {
                    selectedAgentId = foundAgent.id;
                }
            }
        }

        // C. Detekce podle klíčových slov v obsahu
        if (!selectedAgentId) {
            const normalizedText = (subject + ' ' + body).toLowerCase();

            if (/oponent|kontrola|revize|posouzen|audit|chyb|rizik/i.test(normalizedText)) {
                selectedAgentId = 'kontrolor';
            } else if (/smlouv|dopis|sepsat|žalob|podán|draft|vytvoř/i.test(normalizedText)) {
                selectedAgentId = 'spisovatel';
            } else if (/rešerš|judikat|vyhled|analýz|paragraf|zákon/i.test(normalizedText)) {
                selectedAgentId = 'resersnik';
            } else if (/styl|přeps|úprav|formul/i.test(normalizedText)) {
                selectedAgentId = 'stylista';
            } else {
                selectedAgentId = 'sekretarka'; // Výchozí
            }
        }

        // Získat objekt asistenta (pokud neexistuje, fallback na sekretářku)
        const agent = agents[selectedAgentId] || agents['sekretarka'];
        const selectedModel = agent.preferredModel || CHAT_MODEL;

        console.log(`📧 E-mail doručen. Zpracovává asistent: [${agent.name}] přes model [${selectedModel}]`);

        // 3. Generování odpovědi od asistenta
        let replyText = "";
        const cleanBody = body.replace(/^@[a-zA-Z0-9_ěščřžýáíéúůóďťňĎŤŇ]+\s*/, ''); // Odstranit případný tag z těla

        try {
            const response = await ollama.chat({
                model: selectedModel,
                messages: [
                    { role: 'system', content: agent.systemPrompt },
                    { role: 'user', content: cleanBody }
                ],
                options: {
                    temperature: 0.3
                }
            });
            replyText = response.message.content;
        } catch (ollamaErr) {
            console.warn(`⚠️ E-mail: Selhalo spojení s Ollama (${ollamaErr.message}). Používám robustní fallback.`);
            replyText = generateAgentFallback(agent.id, cleanBody);
        }

        // Formátování kompletní e-mailové odpovědi advokátovi
        const dateStr = new Date().toLocaleDateString('cs-CZ', {
            hour: '2-digit',
            minute: '2-digit'
        });

        const fullReply = `Vážený pane doktore,

k Vašemu e-mailovému zadání ze dne ${dateStr} ohledně předmětu "${subject.replace(/\[[^\]]+\]\s*/g, '')}" Vám zasílám požadovaný výstup.

S úctou,
Vaše AI asistentka (${agent.name} ${agent.emoji})

--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
VÝSTUP ASISTENTA:
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

${replyText}`;

        // 4. Uložení do databáze
        const taskItem = {
            sender: sender.trim(),
            subject: subject.trim(),
            body: body.trim(),
            assignedAgentId: agent.id,
            assignedAgentName: agent.name,
            assignedAgentEmoji: agent.emoji,
            responseSent: fullReply,
            status: 'completed'
        };

        const createdTask = db.insert('email_tasks', taskItem);

        // Logování do historie dashboardu
        logEvent('LexisLocal Dashboard', `E-mailový úkol pro asistenta: ${agent.name}`, 'E-mailové úkoly', {
            id: createdTask.id,
            agentId: agent.id,
            subject: subject
        });

        res.json({
            success: true,
            task: createdTask,
            message: "E-mail byl úspěšně zpracován asistentem a odpověď odeslána zpět."
        });

    } catch (err) {
        console.error("Chyba zpracování e-mailového úkolu:", err);
        res.status(500).json({ error: `Chyba při zpracování úkolu: ${err.message}` });
    }
});

module.exports = router;
