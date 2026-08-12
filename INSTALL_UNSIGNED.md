# Instalace LexisLocal (nepodepsaná beta verze)

Aplikace zatím **není podepsaná** vývojářským certifikátem (Apple / Windows).
Funguje plně, jen ji operační systém při prvním spuštění nezná a je potřeba
jednorázově potvrdit, že jí důvěřuješ. Data i chování jsou stejná jako u
podepsané verze.

## macOS

Po stažení `.dmg` a přetažení aplikace do složky Aplikace:

**Varianta A (doporučená, klik):**
1. Ve složce Aplikace klikni na LexisLocal **pravým tlačítkem** (nebo Ctrl+klik).
2. Zvol **Otevřít**.
3. V dialogu znovu **Otevřít**. (Toto stačí udělat jen jednou.)

**Varianta B (Terminál — když macOS hlásí „aplikace je poškozená“):**
Systém přidává staženým souborům karanténní příznak. Odeber ho:
```bash
xattr -dr com.apple.quarantine "/Applications/LexisLocal.app"
```
Poté aplikaci spusť normálně.

> Pozn.: build je opatřen tzv. ad-hoc podpisem (bez certifikátu), takže na
> Apple Silicon (M1/M2/M3) po odebrání karantény běží bez problémů.

## Windows

Po stažení `.exe` (NSIS instalátor):
1. Windows SmartScreen může zobrazit „Systém Windows ochránil váš počítač“.
2. Klikni na **Další informace**.
3. Klikni na **Přesto spustit**.

## Časté dotazy

**Je to bezpečné?** Ano — chybějící podpis znamená jen to, že jsme (zatím)
nezaplatili za vývojářské certifikáty. Nesouvisí to s bezpečností kódu.

**Automatické aktualizace?** Na macOS in-app auto-update funguje spolehlivě
až s podpisem. Do té doby stahuj nové verze ručně z Releases.

**Zpětná vazba na chyby:** [doplnit kanál — e-mail / issue tracker].
