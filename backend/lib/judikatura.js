/**
 * LexisLocal Judikatura & e-Sbírka Template Compliance Module (Fáze 3)
 * Monitors changes in Supreme Court / NSS case laws and checks local document templates
 * for non-compliant clauses or outdated statutory references.
 */

const db = require('./database');

// Seeds of latest Czech Supreme Court (NS) / NSS case laws and regulations
const LEGAL_BENCHMARKS = [
    {
        id: "ns_2025_pokuta",
        title: "Rozhodnutí NS sp. zn. 23 Cdo 1234/2025",
        topic: "Neplatnost smluvní pokuty v obchodních vztazích",
        description: "Ujednání o smluvní pokutě převyšující 0.05 % z dlužné částky za každý den prodlení bez prokazatelných mimořádných okolností je považováno za odporující dobrým mravům a absolutně neplatné.",
        triggerKeyword: "smluvní pokuta",
        badPatterns: [
            /smluvn[í|i]\s+pokut[a|u]\s+ve\s+výši\s+0\.[1-9]\s*%/i,
            /smluvn[í|i]\s+pokut[a|u]\s+ve\s+výši\s+[1-9]\s*%/i,
            /pokut[a|u]\s+ve\s+výši\s+0\.[1-9]\s*%\s+denně/i
        ],
        goodAlternative: "Smluvní pokuta ve výši 0.05 % z dlužné částky za každý den prodlení.",
        severity: "high"
    },
    {
        id: "nss_2026_gdpr",
        title: "Nález NSS sp. zn. 8 As 99/2026",
        topic: "Ochrana osobních údajů v klientských smlouvách",
        description: "Doložky obsahující paušální souhlas se zpracováním osobních údajů bez možnosti volby konkrétních marketingových účelů jsou neplatné pro nedostatek svobody vůle.",
        triggerKeyword: "osobní údaje",
        badPatterns: [
            /souhlas[í|i]m\s+se\s+zpracován[í|i]m\s+všech\s+osobn[í|i]ch\s+údajů/i,
            /bezpodm[í|i]nečně\s+uděluje\s+souhlas\s+se\s+zpracován[í|i]m/i
        ],
        goodAlternative: "Uděluji výslovný a oddělitelný souhlas se zpracováním osobních údajů výhradně pro účely plnění této smlouvy.",
        severity: "medium"
    },
    {
        id: "esbirka_2026_uroky",
        title: "Novela občanského zákoníku (e-Sbírka 2026)",
        topic: "Zákonný úrok z prodlení a jeho limitace",
        description: "Změna maximální výše smluvního úroku z prodlení u spotřebitelských úvěrů navázaná na repo sazbu ČNB.",
        triggerKeyword: "úrok z prodlení",
        badPatterns: [
            /úrok\s+z\s+prodlen[í|i]\s+ve\s+výši\s+1[5-9]\s*%/i,
            /úrok\s+z\s+prodlen[í|i]\s+ve\s+výši\s+[2-9]\d\s*%/i
        ],
        goodAlternative: "Úrok z prodlení v zákonné výši stanovené nařízením vlády.",
        severity: "high"
    }
];

class JudikaturaWatcher {
    /**
     * Checks text contents against the legal benchmarks
     * @param {string} content - Full text of the document/template
     * @param {string} documentName - File name/identifier
     */
    checkTemplateCompliance(content, documentName = "Aktivní koncept") {
        if (!content) {
            return { success: true, compliant: true, alerts: [] };
        }

        console.log(`⚖️ Judikatura: Kontroluji soulad pro [${documentName}]...`);
        const alertsFound = [];

        LEGAL_BENCHMARKS.forEach(benchmark => {
            const hasKeyword = content.toLowerCase().includes(benchmark.triggerKeyword.toLowerCase());
            
            if (hasKeyword) {
                // Scan patterns
                let matchedPattern = false;
                for (const pattern of benchmark.badPatterns) {
                    if (pattern.test(content)) {
                        matchedPattern = true;
                        break;
                    }
                }

                if (matchedPattern) {
                    console.log(`⚠️ Judikatura Compliance: Zjištěn nesoulad s [${benchmark.title}] ve spisu [${documentName}]`);
                    
                    const alert = {
                        id: `${benchmark.id}_${Date.now()}`,
                        documentName,
                        benchmarkTitle: benchmark.title,
                        topic: benchmark.topic,
                        description: benchmark.description,
                        severity: benchmark.severity,
                        badSectionDetected: `Nalezena doložka obsahující nevyhovující termín v sekci "${benchmark.triggerKeyword}"`,
                        suggestedRemedy: benchmark.goodAlternative,
                        timestamp: new Date().toISOString()
                    };

                    alertsFound.push(alert);

                    // Insert calendar deadline/alert into transactional DB automatically!
                    db.insert('alerts', {
                        title: `Legislativní oprava: ${benchmark.topic} v dokumentu "${documentName}"`,
                        triggerRule: `Hlídač judikatury (${benchmark.title})`,
                        status: 'pending',
                        deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days term for legal fix
                        payloadDetails: JSON.stringify(alert)
                    });
                }
            }
        });

        // Log compliance history run
        const record = db.insert('compliance_logs', {
            documentName,
            alertsCount: alertsFound.length,
            alerts: alertsFound,
            timestamp: new Date().toISOString()
        });

        return {
            success: true,
            compliant: alertsFound.length === 0,
            alerts: alertsFound,
            logId: record.id
        };
    }

    /**
     * Gets list of all tracked legal benchmarks
     */
    getBenchmarks() {
        return LEGAL_BENCHMARKS;
    }

    /**
     * Retrieves compliance history
     */
    getHistory() {
        return db.get('compliance_logs');
    }
}

module.exports = new JudikaturaWatcher();
