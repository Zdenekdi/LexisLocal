/**
 * LexisLocal Conflict of Interest Detector (Fáze 3)
 * Scans RAG semantic index and historic metadata to proactively detect conflicts
 * of interest when onboarding new clients and counterparties.
 */

const db = require('./database');
const { searchSimilar } = require('./rag');

class ConflictDetector {
    /**
     * Runs conflict of interest analysis
     * @param {string} clientName - Name of the new onboarding client
     * @param {string} counterpartyName - Name of the counterparty/opponent
     */
    async checkConflict(clientName, counterpartyName) {
        if (!clientName || !counterpartyName) {
            throw new Error("Jméno klienta i protistrany jsou povinné pro prověření konfliktu.");
        }

        console.log(`🔍 Conflicts: Prověřuji střet zájmů pro [Klient: ${clientName}] vs. [Protistrana: ${counterpartyName}]...`);

        const cleanClient = clientName.trim();
        const cleanCounterparty = counterpartyName.trim();

        // 1. Query RAG database for semantic matches
        let clientMatches = [];
        let counterpartyMatches = [];

        let clientSearchOk = true;
        let opponentSearchOk = true;
        try {
            clientMatches = await searchSimilar(cleanClient, 3);
        } catch (e) {
            clientSearchOk = false;
            console.warn("⚠️ Conflicts RAG: Selhalo vyhledávání pro klienta:", e.message);
        }

        try {
            counterpartyMatches = await searchSimilar(cleanCounterparty, 3);
        } catch (e) {
            opponentSearchOk = false;
            console.warn("⚠️ Conflicts RAG: Selhalo vyhledávání pro protistranu:", e.message);
        }

        // Filter high-confidence matches (score >= 0.70)
        const relevantClientHits = clientMatches.filter(m => m.score >= 0.70);
        const relevantOpponentHits = counterpartyMatches.filter(m => m.score >= 0.70);

        // 2. Compute risk level and description
        let riskLevel = 'none';
        let description = 'Nebyly nalezeny žádné historické shody. Onboarding nového klienta je bezpečný.';
        const conflictsFound = [];

        if (relevantOpponentHits.length > 0) {
            // High risk: Opponent matches our historical client archives!
            riskLevel = 'high';
            description = `Upozornění: Protistrana "${cleanCounterparty}" byla nalezena v našich historických spisech s vysokou shodou! Existuje vážné riziko střetu zájmů.`;
            
            relevantOpponentHits.forEach(hit => {
                conflictsFound.push({
                    type: 'counterparty_match',
                    subject: cleanCounterparty,
                    fileName: hit.fileName,
                    score: hit.score,
                    textSnippet: hit.text.substring(0, 180) + "..."
                });
            });
        } else if (relevantClientHits.length > 0) {
            // Medium risk: Client name already has historical precedents
            riskLevel = 'medium';
            description = `Klient "${cleanClient}" již figuruje v naší spisové agendě. Zkontrolujte, zda se nejedná o duplicitní zastupování nebo dřívější spory.`;
            
            relevantClientHits.forEach(hit => {
                conflictsFound.push({
                    type: 'client_match',
                    subject: cleanClient,
                    fileName: hit.fileName,
                    score: hit.score,
                    textSnippet: hit.text.substring(0, 180) + "..."
                });
            });
        }

        // 2b. Selhání vyhledávání NESMÍ vypadat jako „žádný konflikt / bezpečné".
        // Nemožnost prověřit ≠ absence konfliktu — jinak by advokát přijal možná
        // kolizního klienta v důvěře v chybný „bezpečný" výsledek.
        const searchIncomplete = !clientSearchOk || !opponentSearchOk;
        if (searchIncomplete) {
            if (riskLevel === 'none') {
                riskLevel = 'unknown';
                description = 'Prověření střetu zájmů se NEZDAŘILO (vyhledávání/model nedostupné). Konflikt NELZE vyloučit — ověřte ručně před přijetím klienta.';
            } else {
                description += ' ⚠️ Část prověření se nezdařila (vyhledávání nedostupné), výsledek nemusí být úplný — ověřte ručně.';
            }
        }

        // 3. Save report to our encrypted transactional database
        const report = db.insert('conflicts', {
            clientName: cleanClient,
            counterpartyName: cleanCounterparty,
            riskLevel,
            description,
            conflictsFound,
            searchIncomplete,
            timestamp: new Date().toISOString()
        });

        console.log(`🔍 Conflicts: Prověrka dokončena. Riziko: [${riskLevel.toUpperCase()}]`);

        return report;
    }

    /**
     * Gets all previous check histories
     */
    getHistory() {
        return db.get('conflicts');
    }
}

module.exports = new ConflictDetector();
