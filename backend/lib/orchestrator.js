/**
 * LexisLocal Chief Orchestrator Module (Bod 15)
 * Decomposes complex legal queries into sequential sub-tasks, routes them to sandboxed 
 * agents with model-tiering, accumulates context, and synthesizes a final response.
 */

const { loadAgents } = require('./agents');
const { searchSimilar } = require('./rag');
const { checkSubject } = require('./registries');
const ollamaLib = require('ollama');
const ollama = ollamaLib.default || ollamaLib;

class ChiefOrchestrator {
    constructor() {
        this.defaultModel = "llama3";
    }

    /**
     * Main orchestration engine entrypoint
     * @param {string} prompt - Comprehensive user instruction
     * @param {string} context - Active document context from LexisEditor
     * @param {string} globalModel - Default fallback model if preferred not available
     * @param {function} onStepProgress - Optional callback for real-time step reporting in UI
     */
    async orchestrate(prompt, context = "", globalModel = "llama3", onStepProgress = null) {
        console.log("🧩 Chief Orchestrator: Zahajuji zpracování komplexního dotazu...");
        const startTime = Date.now();
        const stepsLog = [];

        // --- KROK 1: Dekompozice (Decomposition) ---
        if (onStepProgress) {
            onStepProgress({ status: "decomposing", message: "Rozkládám komplexní dotaz na dílčí pod-úkoly..." });
        }

        const steps = await this.decomposeQuery(prompt, globalModel);
        console.log(`🧩 Chief Orchestrator: Dekompozice dokončena. Vygenerováno ${steps.length} kroků.`);
        
        let accumulatedContext = "";
        if (context) {
            accumulatedContext += `Výchozí kontext dokumentu z editoru:\n${context}\n\n`;
        }

        // --- KROK 2: Sekvenční spuštění (Delegation & Sandbox) ---
        const agents = loadAgents();

        for (const step of steps) {
            const agent = agents[step.agentId];
            if (!agent) {
                console.warn(`⚠️ Chief Orchestrator: Agent ${step.agentId} nebyl nalezen, přeskakuji krok.`);
                continue;
            }

            const stepModel = agent.preferredModel || globalModel;
            console.log(`🤖 Chief Orchestrator: Spouštím krok ${step.step} s agentem [${agent.name}] (Model: ${stepModel})`);

            if (onStepProgress) {
                onStepProgress({
                    status: "running_step",
                    step: step.step,
                    agentName: agent.name,
                    agentEmoji: agent.emoji,
                    instruction: step.instruction,
                    message: `Spouštím krok ${step.step}: ${agent.name} (${agent.role})`
                });
            }

            // --- SANDBOX: Kontrola oprávnění ---
            let ragContext = "";
            if (agent.permissions && agent.permissions.read_files) {
                try {
                    // Agent má právo číst klientské spisy -> dotážeme sémantické vyhledávání
                    const matches = await searchSimilar(step.instruction, 2);
                    const highConfidence = matches.filter(m => m.score >= 0.70);
                    if (highConfidence.length > 0) {
                        ragContext = highConfidence
                            .map(m => `[Precedent ze spisu: ${m.fileName}]:\n${m.text}`)
                            .join('\n\n');
                        console.log(`🔒 Sandbox: Agentovi [${agent.name}] byl povolen přístup k RAG precedensům.`);
                    }
                } catch (ragErr) {
                    console.warn(`⚠️ Sandbox RAG selhal pro ${agent.name}:`, ragErr.message);
                }
            } else {
                console.log(`🔒 Sandbox: Agent [${agent.name}] nemá oprávnění ke čtení klientských spisů.`);
            }

            let registryContext = "";
            if (agent.permissions && agent.permissions.query_registries) {
                // Agent má právo lustrovat registry -> pokusíme se detekovat IČO v instrukci
                const icoMatch = step.instruction.match(/\b\d{8}\b/);
                if (icoMatch) {
                    try {
                        const ico = icoMatch[0];
                        console.log(`🔒 Sandbox: Detekováno IČO ${ico}. Spouštím automatickou lustraci pro agenta [${agent.name}]`);
                        const regData = await checkSubject(ico);
                        registryContext = `Aktuální ověřená data z registru ARES/ISIR pro IČO ${ico}:\n` +
                                          `- Název: ${regData.name}\n` +
                                          `- Sídlo: ${regData.seat}\n` +
                                          `- V insolvenci: ${regData.inInsolvency ? "ANO" : "NE"}\n` +
                                          `- Insolvenční spis: ${regData.insolvencyCase || "Není"}\n`;
                    } catch (regErr) {
                        console.warn(`⚠️ Sandbox Registries: Automatická lustrace selhala:`, regErr.message);
                    }
                }
            }

            // --- Spuštění lokálního modelu pro krok ---
            const systemContent = `${agent.systemPrompt}\n\n` +
                `Pracuješ v hierarchickém swarmu pod dozorem Chief Orchestrátora. Tvůj úkol je: ${step.instruction}\n` +
                (ragContext ? `\nSchválený bezpečný kontext ze spisů:\n${ragContext}\n` : "") +
                (registryContext ? `\nČerstvá data z registru:\n${registryContext}\n` : "");

            const messages = [
                { role: 'system', content: systemContent }
            ];

            if (accumulatedContext) {
                messages.push({
                    role: 'system',
                    content: `Dosavadní výsledky z předchozích kroků swarmu:\n${accumulatedContext}`
                });
            }

            messages.push({ role: 'user', content: step.instruction });

            try {
                const response = await ollama.chat({
                    model: stepModel,
                    messages: messages,
                    options: { temperature: 0.2 }
                });

                const stepResult = response.message.content;
                accumulatedContext += `\n--- Výstup z kroku ${step.step} (${agent.name}): ---\n${stepResult}\n`;

                stepsLog.push({
                    step: step.step,
                    agentId: step.agentId,
                    agentName: agent.name,
                    agentEmoji: agent.emoji,
                    instruction: step.instruction,
                    output: stepResult
                });

            } catch (chatErr) {
                console.error(`❌ Swarm: Krok ${step.step} selhal při volání modelu:`, chatErr.message);
                accumulatedContext += `\n--- Krok ${step.step} (${agent.name}) selhal s chybou: ${chatErr.message} ---\n`;
            }
        }

        // --- KROK 3: Syntéza (Synthesis) ---
        if (onStepProgress) {
            onStepProgress({ status: "synthesizing", message: "Provádím finální syntézu a kompletaci výsledků swarmu..." });
        }
        console.log("🧩 Chief Orchestrator: Provádím závěrečnou syntézu...");

        const synthesisSystem = "Jsi Chief Orchestrator lokálního právního AI swarmu Lexis.\n" +
            "Tvým úkolem je vzít dosavadní dílčí výstupy a analýzy od specializovaných agentů swarmu a sestavit z nich pro advokáta jednu finální, perfektně strukturovanou, ucelenou a vysoce profesionální odpověď v češtině.\n" +
            "Zajisti, aby text neměl zbytečné duplicity, logicky navazoval a byl připraven k přímému použití v praxi. Pokud některý krok selhal, stručně na to upozorni.";

        const synthesisMessages = [
            { role: 'system', content: synthesisSystem },
            { role: 'user', content: `Komplexní zadání advokáta: ${prompt}\n\nZpracované dílčí výstupy od agentů swarmu:\n${accumulatedContext}` }
        ];

        let finalResponse = "";
        try {
            const response = await ollama.chat({
                model: globalModel,
                messages: synthesisMessages,
                options: { temperature: 0.1 }
            });
            finalResponse = response.message.content;
        } catch (synErr) {
            console.error("❌ Chief Orchestrator: Selhala finální syntéza:", synErr.message);
            finalResponse = `Omlouvám se, nepodařilo se provést finální syntézu. Zde jsou alespoň dílčí nasbírané výstupy:\n\n${accumulatedContext}`;
        }

        const durationMs = Date.now() - startTime;
        console.log(`🏁 Chief Orchestrator: Kompletní orchestrace úspěšně dokončena za ${durationMs}ms.`);

        return {
            success: true,
            prompt,
            steps: stepsLog,
            finalOutput: finalResponse,
            durationMs,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Parses complex user prompt into distinct steps via fast local LLM routing
     */
    async decomposeQuery(prompt, model) {
        const systemPrompt = `Jsi Chief Orchestrator lokálního právního AI swarmu Lexis.
Tvým úkolem je analyzovat komplexní právní pokyn od advokáta a rozložit jej na sled jednotlivých dílčích kroků (sub-tasks).
Musíš vrátit VÝHRADNĚ platné JSON pole objektů bez jakéhokoliv dalšího okecávání, uvození, vysvětlování či markdown značek (neodpovídej v \`\`\`json kódovém bloku).
Každý objekt v poli musí mít tuto přesnou strukturu:
{
  "step": 1,
  "agentId": "resersnik" | "stylista" | "kontrolor" | "sekretarka" | "spisovatel",
  "instruction": "přesná, stručná instrukce pro tohoto dílčího agenta v češtině"
}

Dostupní agenti swarmu:
1. "resersnik" (vyhledávání, analýza zákonů, judikátů, hledání právních opor)
2. "stylista" (úprava stylu, klonování stylu, tón, elegantní advokátní čeština)
3. "kontrolor" (revize rizik, hledání logických chyb, oponentura, slabá místa)
4. "sekretarka" (úprava schůzek, shrnutí úkolů, e-maily, organizace, lustrace IČO)
5. "spisovatel" (psaní smluv, žalob, podání, zapracování změn a odstavců)

Vytvoř maximálně 2 až 4 logické a vysoce efektivní kroky tak, aby na sebe logicky navazovaly.`;

        try {
            const response = await ollama.chat({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                options: { temperature: 0.1 }
            });

            const contentText = response.message.content.trim();
            // Remove markdown code blocks if any got leaked
            const jsonText = contentText.replace(/^```json/i, '').replace(/```$/, '').trim();
            
            const steps = JSON.parse(jsonText);
            if (Array.isArray(steps) && steps.length > 0) {
                return steps;
            }
        } catch (e) {
            console.warn("⚠️ Selhala inteligentní dekompozice, vracím výchozí lineární plán:", e.message);
        }

        // Safe deterministic fallback decomposition if LLM fails formatting
        return [
            {
                step: 1,
                agentId: "resersnik",
                instruction: `Proveď úvodní analýzu a vyhledej právní oporu pro: ${prompt}`
            },
            {
                step: 2,
                agentId: "spisovatel",
                instruction: `Sestav text dokumentu či výstupu na základě úvodní analýzy.`
            },
            {
                step: 3,
                agentId: "kontrolor",
                instruction: `Zkontroluj vygenerovaný dokument na právní a věcná rizika a navrhni úpravy.`
            }
        ];
    }
}

module.exports = new ChiefOrchestrator();
