# LexisLocal — stav zralosti (poctivá matice)

Tento soubor záměrně **nepřeprodává**. Rozlišuje tři úrovně:
**Unit** = pokryto automatickými testy (logika). **Runtime** = ověřeno v běžící aplikaci.
**Prod** = ověřeno v reálném provozu u uživatele. Aktuální stav ověříš příkazem
`npm run readiness` a `npm test`.

| Oblast | Unit | Runtime | Prod | Poznámka |
|---|:--:|:--:|:--:|---|
| RAG: chunking, per-agent KB, úrovně přístupu | ✅ | 🟡 | ❌ | Sémantika vyžaduje běžící embedding model (Ollama/API). Bez něj běží jen lexikálně. |
| Nahrávání do KB (PDF/DOCX/TXT/OCR) | ✅ | 🟡 | ❌ | 8/8 HTTP smoke; OCR skenů ověřit v běhu. |
| Eval harness (recall@k/MRR) | ✅ | ✅ | ❌ | Reálná čísla jen s naplněnými KB + modelem. |
| Konflikty zájmů (fail-closed) | ✅ | 🟡 | ❌ | Při výpadku vyhledávání → „unknown", nikdy „bez konfliktu". |
| AML screening | ✅ | 🟡 | ❌ | **Lokální screening NENAHRAZUJE** oficiální PEP/sankční seznamy. |
| Provider-agnostic AI (Ollama/OpenAI/Anthropic) | ✅ | 🟡 | ❌ | Klíče přes ENV, nikdy v kódu. |
| Kvalita AI odpovědí na reálné úlohy | ❌ | ❌ | ❌ | **Neověřeno.** Nutné doložit na reálných českých právních úlohách. |

## Co je potřeba k „produkčně hotovo"
- Spustit embedding model a doložit **sémantickou** kvalitu RAG (ne jen lexikální).
- Runtime ověření OCR, uploadu a integrací proti reálným datům.
- Bezpečnostní/GDPR review nakládání s klientskými daty + zpracovatelská smlouva (DPA).
