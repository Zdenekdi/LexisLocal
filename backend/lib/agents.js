/**
 * LexisLocal AI Agents Persistence Module
 * Manages dynamically configured agents stored inside the local WATCH_DIR/.agents.json file.
 */

const fs = require('fs');
const { CHAT_MODEL } = require('./model_config');
const path = require('path');

const { WATCH_DIR, dataPath } = require('./config'); // jeden zdroj pravdy, viz lib/config.js
const AGENTS_PATH = dataPath('.agents.json'); // konfigurace agentů — DATA_DIR

// Default built-in system agents
const DEFAULT_AGENTS = {
    resersnik: {
        id: "resersnik",
        name: "Rešeršník",
        emoji: "📚",
        role: "Vyhledávání v zákonech a judikatuře. Formulace právních argumentů.",
        systemPrompt: "Jsi zkušený český advokátní koncipient zaměřený na rešerše. Tvým úkolem je na základě zadaných právních předpisů a judikátů vypracovat objektivní právní rozbor.",
        isSystem: true,
        preferredModel: CHAT_MODEL,
        permissions: {
            read_files: true,
            query_registries: true,
            write_desktop: false
        }
    },
    stylista: {
        id: "stylista",
        name: "Stylista",
        emoji: "✍️",
        role: "Klonování stylu advokáta. Přepisování textu do elegantní advokátní češtiny.",
        systemPrompt: "Jsi expert na stylistiku a právní psaní. Tvým úkolem je upravit text tak, aby působil nanejvýš profesionálně, autoritativně, přesvědčivě a přirozeně.",
        isSystem: true,
        preferredModel: CHAT_MODEL,
        permissions: {
            read_files: false,
            query_registries: false,
            write_desktop: false
        }
    },
    kontrolor: {
        id: "kontrolor",
        name: "Kontrolor",
        emoji: "⚖️",
        role: "Detekce rizik, protimluvů a slabých míst v argumentaci.",
        systemPrompt: "Jsi oponentní právní zástupce. Tvým úkolem je kriticky zhodnotit předložený text, najít v něm logické chyby, slabá místa a navrhnout protiargumenty.",
        isSystem: true,
        preferredModel: "mistral",
        permissions: {
            read_files: true,
            query_registries: false,
            write_desktop: false
        }
    },
    sekretarka: {
        id: "sekretarka",
        name: "Sekretářka",
        emoji: "⏰",
        role: "Správa spisové agendy, formátování doložek, extrakce schůzek a úkolů.",
        systemPrompt: "Jsi vysoce organizovaná a profesionální advokátní sekretářka. Tvým úkolem je pomáhat advokátům strukturovat úkoly, shrnout termíny, upravovat tón e-mailové komunikace s klienty a organizovat spisové složky.",
        isSystem: true,
        preferredModel: CHAT_MODEL,
        permissions: {
            read_files: false,
            query_registries: true,
            write_desktop: true
        }
    },
    spisovatel: {
        id: "spisovatel",
        name: "Spisovatel",
        emoji: "📝",
        role: "Tvorba a úprava právních dokumentů (žaloby, smlouvy, odvolání) na míru.",
        systemPrompt: "Jsi špičkový český advokát a mistr legislativního a kontraktuálního draftování (Lexis Writing Agent). Tvým úkolem je na základě zadání sestavovat precizní, bezchybné a strukturované právní dokumenty (zejména smlouvy, dohody, podání k soudu, odvolání, žaloby) odpovídající standardům kvality a struktury profesionálních vzorů z portálu POHODA (portal.pohoda.cz) a aktuálnímu občanskému zákoníku (zákon č. 89/2012 Sb.). Každá generovaná smlouva musí být úplná a strukturovaná do přehledných článků označených římskými číslicemi (Článek I až Článek X, podle povahy): 1. SMLUVNÍ STRANY (název/jméno, sídlo/bydliště, IČO, DIČ, zapsaná v obchodním rejstříku, zastoupená, bankovní spojení a číslo účtu s prázdnými poli [Doplnit...]), 2. ČLÁNEK I. PŘEDMĚT SMLOUVY, 3. ČLÁNEK II. DOBA A MÍSTO PLNĚNÍ, 4. ČLÁNEK III. CENA A PLATEBNÍ PODMÍNKY (cena, DPH, splatnost 14 dnů), 5. ČLÁNEK IV. PRÁVA A POVINNOSTI STRAN, 6. ČLÁNEK V. PŘEDÁNÍ A PŘEVZETÍ, 7. ČLÁNEK VI. ODPOVĚDNOST ZA VADY A ZÁRUKA, 8. ČLÁNEK VII. SMLUVNÍ POKUTY A SANKCE, 9. ČLÁNEK VIII. ZÁVĚREČNÁ USTANOVENÍ, 10. PODPISOVÝ BLOK. Piš v českém jazyce, s vysokou právní přesností, bez jakýchkoliv neformálních komentářů či úvodních a závěrečných zdvořilostních frází. Výsledkem musí být přímo použitelný právní text.",
        isSystem: true,
        preferredModel: CHAT_MODEL,
        permissions: {
            read_files: true,
            query_registries: false,
            write_desktop: true
        }
    }
};

// Prefix partition znalostní báze agenta (musí odpovídat rag.js KB_PREFIX).
const KB_PREFIX = '_kb_';
// Povolené úrovně přístupu agenta ke KLIENTSKÝM spisům:
//   'full'     — agent čte vybraný spis v plném znění,
//   'redacted' — agent čte spis, ale ANONYMIZOVANĚ (jména/RČ/adresy začerněny),
//   'none'     — agent NEČTE klientské spisy, čerpá jen z vlastní znalostní báze.
const SPIS_ACCESS_LEVELS = ['full', 'redacted', 'none'];

/**
 * Doplní agentovi RAG pole s rozumnými výchozími hodnotami:
 *   knowledgeScope — vlastní znalostní báze `_kb_<id>` (per-agent RAG),
 *   spisAccess     — úroveň přístupu ke klientským spisům (default dle read_files).
 * Idempotentní; už nastavené (validní) hodnoty zachová.
 */
function normalizeAgent(agent) {
    if (!agent || typeof agent !== 'object') return agent;
    const id = agent.id || 'agent';
    if (!agent.knowledgeScope) agent.knowledgeScope = KB_PREFIX + id;
    if (!SPIS_ACCESS_LEVELS.includes(agent.spisAccess)) {
        const readFiles = !!(agent.permissions && agent.permissions.read_files);
        agent.spisAccess = readFiles ? 'full' : 'none';
    }
    return agent;
}
function normalizeAgents(agents) {
    for (const k of Object.keys(agents || {})) normalizeAgent(agents[k]);
    return agents;
}

/**
 * Loads agents config, initializing default file if missing
 */
function loadAgents() {
    try {
        if (fs.existsSync(AGENTS_PATH)) {
            const data = fs.readFileSync(AGENTS_PATH, 'utf-8');
            return normalizeAgents(JSON.parse(data));
        }
    } catch (err) {
        console.error("⚠️ Chyba při čtení .agents.json:", err.message);
    }

    // Default initializer (normalizovaná kopie, ať nemutujeme DEFAULT_AGENTS)
    const seeded = normalizeAgents(JSON.parse(JSON.stringify(DEFAULT_AGENTS)));
    saveAllAgents(seeded);
    return seeded;
}

/**
 * Saves all agents back to the file
 */
function saveAllAgents(agents) {
    try {
        fs.writeFileSync(AGENTS_PATH, JSON.stringify(agents, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error("⚠️ Chyba při ukládání .agents.json:", err.message);
        return false;
    }
}

/**
 * Updates or creates a single agent
 */
function saveAgent(agentId, agentData) {
    const agents = loadAgents();
    
    // Ensure ID is set
    const cleanId = agentId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    
    agents[cleanId] = {
        id: cleanId,
        name: agentData.name || "Nový Agent",
        emoji: agentData.emoji || "🤖",
        role: agentData.role || "Bez popisku",
        systemPrompt: agentData.systemPrompt || "Jsi užitečný AI pomocník.",
        isSystem: agents[cleanId] ? !!agents[cleanId].isSystem : false,
        preferredModel: agentData.preferredModel || CHAT_MODEL,
        permissions: agentData.permissions || {
            read_files: false,
            query_registries: false,
            write_desktop: false
        },
        // Per-agent RAG: vlastní znalostní báze + úroveň přístupu ke spisům.
        knowledgeScope: agentData.knowledgeScope || KB_PREFIX + cleanId,
        spisAccess: SPIS_ACCESS_LEVELS.includes(agentData.spisAccess) ? agentData.spisAccess : undefined
    };

    normalizeAgent(agents[cleanId]); // doplní/opraví spisAccess (když přišlo undefined)
    saveAllAgents(agents);
    return agents[cleanId];
}

/**
 * Deletes a single custom agent
 */
function deleteAgent(agentId) {
    const agents = loadAgents();
    if (agents[agentId]) {
        if (agents[agentId].isSystem) {
            throw new Error("Systémové agenty nelze smazat.");
        }
        delete agents[agentId];
        saveAllAgents(agents);
        return true;
    }
    return false;
}

/**
 * Resets a system agent back to defaults
 */
function resetAgentToDefault(agentId) {
    if (DEFAULT_AGENTS[agentId]) {
        const agents = loadAgents();
        agents[agentId] = normalizeAgent({ ...DEFAULT_AGENTS[agentId] });
        saveAllAgents(agents);
        return agents[agentId];
    }
    throw new Error("Agent není systémovým agentem.");
}

module.exports = {
    loadAgents,
    saveAgent,
    deleteAgent,
    resetAgentToDefault,
    normalizeAgent,
    SPIS_ACCESS_LEVELS,
    KB_PREFIX,
    DEFAULT_AGENTS
};
