/**
 * LexisLocal Time-tracking & Activity Logging Module (Fáze 2)
 * Logs editor active heartbeats and aggregates them into daily structured timesheets
 * using local LLM synthesis.
 */

const db = require('./database');
const ollamaLib = require('ollama');
const ollama = ollamaLib.default || ollamaLib;

class TimeTracker {
    /**
     * Logs a single activity heartbeat from LexisEditor
     * @param {string} documentName - Name of active case file
     * @param {number} activeSeconds - Seconds elapsed in active window (defaults to 30)
     * @param {string} actionType - 'edit' | 'write' | 'review' | 'idle'
     * @param {string} dateStr - Optional ISO date override
     */
    logActivity(documentName, activeSeconds = 30, actionType = 'edit', dateStr = null) {
        const cleanDocName = documentName ? documentName.trim() : "Nepojmenovaný dokument";
        const cleanSecs = parseInt(activeSeconds) || 30;
        
        console.log(`🕒 Time-tracking: Loguji ${cleanSecs}s práce na [${cleanDocName}] (${actionType})`);
        
        return db.insert('activities', {
            documentName: cleanDocName,
            activeSeconds: cleanSecs,
            actionType,
            timestamp: dateStr || new Date().toISOString()
        });
    }

    /**
     * Retrieves all logs for a specific day (default: today)
     * @param {string} targetDate - 'YYYY-MM-DD'
     */
    getDailyActivities(targetDate = null) {
        const todayStr = targetDate || new Date().toISOString().split('T')[0];
        const allActivities = db.get('activities');
        
        // Filter by calendar date part of timestamp
        return allActivities.filter(act => act.timestamp.startsWith(todayStr));
    }

    /**
     * Aggregates activity logs into a compact summary object
     * @param {Array} activities 
     */
    aggregateActivities(activities) {
        const docSummary = {};
        
        activities.forEach(act => {
            const doc = act.documentName;
            if (!docSummary[doc]) {
                docSummary[doc] = {
                    documentName: doc,
                    totalSeconds: 0,
                    saves: 0,
                    actions: new Set()
                };
            }
            
            docSummary[doc].totalSeconds += act.activeSeconds;
            docSummary[doc].saves += 1;
            docSummary[doc].actions.add(act.actionType);
        });

        // Convert set to array and format time
        return Object.values(docSummary).map(doc => ({
            documentName: doc.documentName,
            totalSeconds: doc.totalSeconds,
            totalHours: parseFloat((doc.totalSeconds / 3600).toFixed(2)),
            saves: doc.saves,
            primaryAction: Array.from(doc.actions).join(', ')
        }));
    }

    /**
     * Synthesizes a structured daily timesheet from aggregated logs using local LLM
     * @param {string} targetDate - 'YYYY-MM-DD'
     * @param {string} model - LLM model name
     */
    async generateDailyTimesheet(targetDate = null, model = "llama3") {
        const todayStr = targetDate || new Date().toISOString().split('T')[0];
        const activities = this.getDailyActivities(todayStr);
        
        if (activities.length === 0) {
            return {
                success: false,
                message: "Pro vybraný den nebyly nalezeny žádné záznamy o aktivitě."
            };
        }

        const summary = this.aggregateActivities(activities);
        let summaryText = "";
        summary.forEach(item => {
            summaryText += `- Dokument: "${item.documentName}", Celkový čas: ${item.totalHours} hod, Počet změn: ${item.saves}, Typ činnosti: ${item.primaryAction}\n`;
        });

        console.log(`🕒 Time-tracking: Generuji denní výkaz přes [${model}] pro ${todayStr}...`);

        const systemPrompt = `Jsi profesionální český advokátní asistent a expert na time-tracking.
Tvým úkolem je vzít surová strukturovaná data o aktivitě advokáta v editoru a přetvořit je do elegantního, vysoce profesionálního, strukturovaného výkazu práce (timesheetu) pro klienty.

Surová data o aktivitě:
${summaryText}

Tvůj výstup musí být čistě věcný a profesionální přehled činností v češtině, kde každý řádek popisuje samostatný dokument a činnost na něm.
Formát výpisu (použij odrážky):
- [Název dokumentu]: [Právní popis činnosti s ohledem na čas, např. "Komplexní revize, úprava věcných a procesních doložek a právní analýza podání (Celkem: 1.5 hod)"]

Nepiš žádný úvodní ani závěrečný komentář (např. "Zde je váš výkaz..."), rovnou vypiš hotové odrážky výkazu.`;

        try {
            const response = await ollama.chat({
                model: model,
                messages: [
                    { role: 'user', content: systemPrompt }
                ],
                options: { temperature: 0.2 }
            });

            const synthesizedText = response.message.content.trim();
            
            // Save timesheet to encrypted database
            const savedTimesheet = db.insert('timesheets', {
                date: todayStr,
                rawSummary: summaryText,
                synthesizedOutput: synthesizedText,
                totalHours: summary.reduce((sum, item) => sum + item.totalHours, 0)
            });

            return {
                success: true,
                timesheet: savedTimesheet
            };

        } catch (err) {
            console.error("❌ Time-tracking: Selhalo LLM generování výkazu:", err.message);
            
            // Fallback generation in case of LLM error
            let fallbackText = "--- Automatický výkaz práce (Záložní generátor) ---\n";
            summary.forEach(item => {
                fallbackText += `- ${item.documentName}: Práce na dokumentu - ${item.primaryAction} (${item.totalHours} hod)\n`;
            });

            const savedTimesheet = db.insert('timesheets', {
                date: todayStr,
                rawSummary: summaryText,
                synthesizedOutput: fallbackText,
                totalHours: summary.reduce((sum, item) => sum + item.totalHours, 0),
                isFallback: true
            });

            return {
                success: true,
                timesheet: savedTimesheet,
                warning: `LLM selhal, použit záložní výpis. Chyba: ${err.message}`
            };
        }
    }
}

module.exports = new TimeTracker();
