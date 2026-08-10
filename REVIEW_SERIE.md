# Přehled série oprav a review — LexisLocal / LexisEditor

_Audit/QA série: procházení legálně, finančně a bezpečnostně kritických modulů, hledání a oprava reálných defektů. Každá oprava zachovává původní chování na neproblémových vstupech a je krytá testy._

---

## Souhrn

**Nalezeno a opraveno: 6 reálných bugů + 1 bezpečnostní zpevnění.** Dva moduly prověřeny jako v pořádku. Vše s testy, ověřeno `node --check` + cílenými harnessy (jest u tebe doběhne v běžném prostředí).

| # | Modul | Typ | Dopad před opravou |
|---|-------|-----|--------------------|
| 1 | `anonymizer` | bug | Peněžní částky (123 456 789 Kč) redigovány jako [TELEFON] → poškození textu / skrytí částky |
| 2 | `citation_verifier` | bug | „§ X zákona Y" s více zákony přiřadil § ke špatnému zákonu → falešné „neexistuje"/„ověřeno" |
| 3 | `conflicts` | bug | Selhání RAG vyhledávání hlášeno jako „bez konfliktu, bezpečné" → riziko přijetí kolizního klienta |
| 4 | `hearings` | bug | Reschedule bral `udalosti[0]` → jednání mohlo být posunuto do minulosti → přestalo se hlídat |
| 5 | `mailer` | zpevnění | Chyběl `requireTLS` na 587 → důvěrný e-mail mohl jít v plaintextu |
| 6 | `timetracking` | bug | Součet hodin ze zaokrouhlených dílčích hodnot → nepřesná fakturace + float šum |
| 7 | `judikatura` | bug | Compliance vzory matchovaly jen tečku (0.5 %), ne českou čárku (0,5 %) → nesoulad neodhalen |

**Prověřeno jako v pořádku:** `agent_tokens` (silná náhoda, oprávněný SHA-256 bez soli, konstantní porovnání bezpečné vůči délce, fail-closed), `orchestrator` (bezpečný fallback dekompozice, ošetřená selhání, respektovaný sandbox).

---

## Detail oprav

**1. `anonymizer` (GDPR).** Pravidlo pro telefon `NNN NNN NNN` bralo i částky po tisících. Zúženo na české tel. prefixy `[2-9]` + negativní lookahead na měnu/další číslice. PII (e-mail, RČ, telefon, jméno) se dál rediguje; částky a spisové značky zůstávají. Nový `anonymizer.test.js`.

**2. `citation_verifier`.** Přiřazení zákona k paragrafu změněno z „nejbližší předcházející" na „nejbližší dle absolutní vzdálenosti" — pokryje „§ X zákona Y" (nejčastější) i „zákona Y … § X". Testy doplněny.

**3. `conflicts`.** Při selhání kteréhokoli vyhledávání teď `riskLevel: 'unknown'` + `searchIncomplete` + jasné „konflikt NELZE vyloučit, ověřte ručně". Úspěšné prázdné hledání dál vrací `'none'`. (Ověřen i směr prahu: cosinová podobnost, `>= 0.70` je správně — inverze vyloučena.) Testy.

**4. `hearings`.** Reschedule vybírá nejbližší **budoucí** událost; do minulosti neposouvá; jen minulé události → beze změny. Výpadek API i prázdný seznam dál jednání neruší. Přidán fetch-mock test pro dosud netestovaný `checkAllHearings`.

**5. `mailer`.** `requireTLS: true` jako výchozí na STARTTLS cestě (opt-out `smtp_allow_insecure`); konfigurace vytažena do testovatelné `buildTransportConfig`. Testy.

**6. `timetracking`.** Denní součet hodin se počítá z celkových sekund a zaokrouhlí jednou (`totalHoursFromSummary`) — přesná fakturace, bez float šumu. Guard na chybějící timestamp. Testy.

**7. `judikatura`.** Compliance vzory pro smluvní pokutu: desetinný oddělovač `[.,]` + rozsah `0[.,](?:0[6-9]|[1-9])` — chytne vše nad 0,05 %, mez 0,05 % zůstává nekolizní. Testy.

---

## Zbývá výhradně na tvé rozhodnutí

Tyto věci jsem záměrně neudělal — jsou to buď akce, které musíš provést ty, nebo produktová/právní rozhodnutí, kde nechci hádat.

1. **Vynucení API tokenu na výchozí.** Připraven `scripts/smoke-token.sh` (ověří 401/200). Po jeho spuštění a proklikání editoru přepnout `ENFORCE_TOKEN` na výchozí zapnuto. Vyžaduje reálný běh na Macu.
2. **Edice Pro vs. základ.** Mechanismus (`lexis-edition.js`) je hotový a otestovaný; zbývá otagovat konkrétní prvky `data-pack="legal/business"` — tj. rozhodnout, **co přesně je placené**.
3. **Napojení pipeline lhůt v měsících/týdnech.** Výpočet i detekce jsou hotové a otestované v editoru i backendu (`computeDeadlineByUnit`, `detectDeadlines`). Zbývá napojit `watcher.js`/`paperless.js` + AI extraktor, aby ukládaly jednotky — mění to automatickou (nepotvrzovanou) cestu, proto k tvému schválení.
4. **Orchestrator + GDPR.** Rozhodnout, zda RAG text z klientských spisů anonymizovat před modelem / v `transparency_logs` (u lokálního modelu nízké riziko; anonymizace může zhoršit kvalitu). Viz flag v `CLAUDE.md`.

---

_Každá oprava má samostatný commit (viz zprávy commitů). Detailní stav je průběžně veden v `CLAUDE.md` obou repozitářů._
