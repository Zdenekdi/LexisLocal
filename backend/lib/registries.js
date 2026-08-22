/**
 * LexisLocal Registries Utility
 * Directly queries Czech public registries:
 * 1. ARES REST API (Ministry of Finance) for company name and official seat.
 * 2. ISIR SOAP Web Service (Ministry of Justice) for active insolvency check.
 */

const https = require('https');
const db = require('./database');

// Demo/testovací fixtures (smyšlené subjekty) jsou aktivní jen v demo/test režimu.
// V produkci se i tato IČO dotazují reálných registrů — nikdy nevracíme
// fabrikovaná data jako ověřená.
const DEMO_FIXTURES = process.env.LEXIS_DEMO === '1' || process.env.NODE_ENV === 'test';

/**
 * Robust native HTTPS helper to avoid extra external package dependencies
 */
// Konfigurace registrů: přednost má hodnota uložená v aplikaci (DB settings),
// jinak fallback na proměnnou prostředí. Umožňuje zadat klíče přímo v UI.
function _regSetting(dbKey, envKey) {
    try {
        const s = (db.get('settings') || []).find(x => x.key === dbKey);
        if (s && s.value != null && String(s.value).trim() !== '') return String(s.value);
    } catch (e) { /* ignore */ }
    return process.env[envKey] || '';
}
function _saveSetting(dbKey, value) {
    const list = db.get('settings') || [];
    const ex = list.find(x => x.key === dbKey);
    if (ex) db.update('settings', ex.id, { value: String(value) });
    else db.insert('settings', { key: dbKey, value: String(value) });
}

function fetchUrl(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const requestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: 5000 // 5 seconds timeout to keep it responsive
        };

        const req = https.request(requestOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    let errMsg = data.trim();
                    if (errMsg.includes('<!DOCTYPE') || errMsg.includes('<html') || errMsg.includes('<HTML')) {
                        errMsg = `[HTML/XML chybová stránka - délka ${errMsg.length} znaků]`;
                    } else if (errMsg.length > 150) {
                        errMsg = errMsg.substring(0, 150) + '...';
                    }
                    reject(new Error(`HTTP ${res.statusCode}: ${errMsg}`));
                }
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Požadavek vypršel (Timeout)'));
        });

        req.on('error', (err) => reject(err));

        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

/**
 * Queries the official ARES REST API
 */
async function checkAres(ico) {
    if (DEMO_FIXTURES && (ico === "12345678" || ico === "88888888")) {
        return {
            ico: ico,
            name: ico === "12345678" ? "Úpadce s.r.o." : "Rizikový Věřitel a.s.",
            seat: "Vodičkova 736/17, Nové Město, 11000 Praha 1",
            simulated: true
        };
    }
    try {
        const url = `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ico}`;
        const rawJson = await fetchUrl(url, {
            headers: { 'Accept': 'application/json' }
        });
        const data = JSON.parse(rawJson);
        
        let officialSeat = '';
        if (data.sidlo) {
            if (data.sidlo.textovaAdresa) {
                officialSeat = data.sidlo.textovaAdresa;
            } else {
                officialSeat = `${data.sidlo.nazevUlice || ''} ${data.sidlo.cisloDomovni || ''}/${data.sidlo.cisloOrientacni || ''}, ${data.sidlo.nazevObce || ''}`;
                officialSeat = officialSeat.replace(/\s+/g, ' ').trim();
            }
        }
        
        return {
            ico: data.ico,
            name: data.obchodniJmeno,
            seat: officialSeat || "Sídlo neuvedeno"
        };
    } catch (e) {
        console.warn(`⚠️ Chyba ARES pro IČO ${ico}:`, e.message);
        return null;
    }
}

/**
 * Queries the official Ministry of Justice SOAP Web Service (ISIR)
 */
async function checkIsir(ico) {
    if (DEMO_FIXTURES && (ico === "12345678" || ico === "88888888")) {
        return {
            inInsolvency: true,
            caseNumber: "MSP-123/2026",
            status: "Zahájené insolvenční řízení",
            simulated: true
        };
    }
    try {
        const url = 'https://isir.justice.cz:8443/isir_cuzk_ws/IsirWsCuzkService';
        const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:typ="http://isirws.cca.cz/types/">
   <soapenv:Header/>
   <soapenv:Body>
      <typ:getIsirWsCuzkDataRequest>
         <ic>${ico}</ic>
      </typ:getIsirWsCuzkDataRequest>
   </soapenv:Body>
</soapenv:Envelope>`;

        const xmlResponse = await fetchUrl(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml;charset=UTF-8',
                'SOAPAction': ''
            },
            body: soapBody
        });
        
        // Parse results safely using regular expressions to avoid heavy XML parsers
        const hasInsolvency = xmlResponse.includes('<urlDetailRizeni>');
        if (hasInsolvency) {
            const matchStatus = xmlResponse.match(/<druhStavKonkursu>([^<]+)<\/druhStavKonkursu>/);
            const matchCase = xmlResponse.match(/<cisloSenatu>([^<]+)<\/cisloSenatu>[\s\S]*?<druhVec>([^<]+)<\/druhVec>[\s\S]*?<bcVec>([^<]+)<\/bcVec>[\s\S]*?<rocnik>([^<]+)<\/rocnik>/);
            
            let caseNumber = "Aktivní insolvenční řízení";
            if (matchCase) {
                caseNumber = `INS ${matchCase[1]} ${matchCase[2]} ${matchCase[3]}/${matchCase[4]}`;
            }
            
            return {
                inInsolvency: true,
                caseNumber: caseNumber,
                status: matchStatus ? matchStatus[1].trim() : "Aktivní insolvence"
            };
        }
        
        return { inInsolvency: false };
    } catch (e) {
        console.warn(`⚠️ Chyba ISIR pro IČO ${ico}:`, e.message);
        return { inInsolvency: false, error: e.message };
    }
}

/**
 * Combined public registry lookup engine
 */
async function checkSubject(ico) {
    const cleanIco = ico.replace(/\s+/g, '').replace(/[^0-9]/g, '').trim();
    if (!cleanIco || cleanIco.length !== 8) {
        return { error: "IČO musí obsahovat přesně 8 číslic." };
    }
    
    console.log(`🔍 Lustruji subjekt: ${cleanIco} (ARES + ISIR)...`);
    
    // Execute calls concurrently for maximum performance
    const [ares, isir] = await Promise.all([
        checkAres(cleanIco),
        checkIsir(cleanIco)
    ]);
    
    return {
        ico: cleanIco,
        name: ares ? ares.name : "ARES nedostupný / Selhal dotaz",
        seat: ares ? ares.seat : "Adresa nezjištěna",
        inInsolvency: isir.inInsolvency,
        insolvencyCase: isir.caseNumber || null,
        insolvencyStatus: isir.error ? `ISIR nedostupný (${isir.error})` : (isir.status || null),
        verifiedAt: new Date().toISOString()
    };
}

/**
 * CEE (Centrální evidence exekucí) — REÁLNÝ dotaz přes konfigurované API.
 * Vyžaduje placený přístup Exekutorské komory ČR. Bez konfigurace NEVRACÍ žádná
 * data (žádné odhady) — jen čestné „není k dispozici".
 * ENV: CEE_API_URL (obsahuje {ico}), CEE_API_KEY (volitelně).
 */
async function checkCee(ico) {
    const cleanIco = String(ico || '').replace(/\D/g, '');
    const url = _regSetting('registry_cee_url', 'CEE_API_URL');
    if (!url) {
        return { available: false, configured: false,
            reason: 'CEE (Centrální evidence exekucí) vyžaduje placený přístup Exekutorské komory ČR. Nastavte CEE_API_URL (a CEE_API_KEY).' };
    }
    try {
        const key = _regSetting('registry_cee_key', 'CEE_API_KEY');
        const raw = await fetchUrl(url.replace('{ico}', encodeURIComponent(cleanIco)),
            { headers: key ? { 'Authorization': 'Bearer ' + key, 'Accept': 'application/json' } : { 'Accept': 'application/json' } });
        const data = JSON.parse(raw);
        // Mapování na konkrétní pole poskytovatele (raw ponechán pro transparentnost).
        return {
            available: true, configured: true,
            activeExecutions: (typeof data.activeExecutions === 'number') ? data.activeExecutions : (Array.isArray(data.executions) ? data.executions.length : null),
            totalAmount: (typeof data.totalAmount === 'number') ? data.totalAmount : null,
            raw: data
        };
    } catch (e) {
        return { available: false, configured: true, error: 'Dotaz do CEE selhal: ' + e.message };
    }
}

/**
 * Katastr nemovitostí (ČÚZK) — REÁLNÝ dotaz přes konfigurované API (dálkový přístup).
 * Vyžaduje registrovaný/placený přístup ČÚZK. Bez konfigurace NEVRACÍ žádná data.
 * ENV: KATASTR_API_URL (obsahuje {ico}), KATASTR_API_KEY (volitelně).
 */
async function checkKatastr(ico) {
    const cleanIco = String(ico || '').replace(/\D/g, '');
    const url = _regSetting('registry_katastr_url', 'KATASTR_API_URL');
    if (!url) {
        return { available: false, configured: false,
            reason: 'Katastr nemovitostí (ČÚZK, dálkový přístup) vyžaduje registrovaný/placený přístup. Nastavte KATASTR_API_URL (a KATASTR_API_KEY).' };
    }
    try {
        const key = _regSetting('registry_katastr_key', 'KATASTR_API_KEY');
        const raw = await fetchUrl(url.replace('{ico}', encodeURIComponent(cleanIco)),
            { headers: key ? { 'Authorization': 'Bearer ' + key, 'Accept': 'application/json' } : { 'Accept': 'application/json' } });
        const data = JSON.parse(raw);
        return {
            available: true, configured: true,
            propertiesCount: (typeof data.propertiesCount === 'number') ? data.propertiesCount : (Array.isArray(data.properties) ? data.properties.length : null),
            hasPlomba: (typeof data.hasPlomba === 'boolean') ? data.hasPlomba : null,
            raw: data
        };
    } catch (e) {
        return { available: false, configured: true, error: 'Dotaz do katastru selhal: ' + e.message };
    }
}

/**
 * ISDS — vyhledání datové schránky podle IČO (operace FindDataBox).
 * REÁLNÝ dotaz, když jsou nastaveny přihlašovací údaje do ISDS. Bez nich NEVRACÍ
 * žádné ID (a NIKDY nefabrikuje) — jen čestné „není k dispozici". Při více shodách
 * je výsledek NEjednoznačný (fail-closed) a vyžaduje ruční volbu.
 * ENV/DB: ISDS_WS_URL (volitelné), ISDS_LOGIN, ISDS_PASSWORD.
 * ⚠ SOAP tělo a parsování jsou izolované a provizorní — finalizovat proti reálnému ISDS WS.
 */
const ISDS_DEFAULT_URL = 'https://ws1.mojedatovaschranka.cz/DS/df';

function _isdsCfg() {
    return {
        url: _regSetting('registry_isds_url', 'ISDS_WS_URL') || ISDS_DEFAULT_URL,
        login: _regSetting('registry_isds_login', 'ISDS_LOGIN'),
        password: _regSetting('registry_isds_password', 'ISDS_PASSWORD')
    };
}
function isIsdsConfigured() { const c = _isdsCfg(); return !!(c.login && c.password); }

async function findDataBox(ico, opts = {}) {
    const doFetch = (opts && opts.fetchUrl) || fetchUrl;
    const cleanIco = String(ico || '').replace(/\D/g, '');
    if (cleanIco.length !== 8) {
        return { available: false, configured: isIsdsConfigured(), reason: 'IČO musí obsahovat přesně 8 číslic.' };
    }
    const c = _isdsCfg();
    if (!c.login || !c.password) {
        return { available: false, configured: false,
            reason: 'Vyhledání datové schránky vyžaduje přihlašovací údaje do ISDS (ISDS_LOGIN/ISDS_PASSWORD).' };
    }
    try {
        const soapBody = '<?xml version="1.0" encoding="utf-8"?>' +
            '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:p="http://isds.czechpoint.cz/v20">' +
            '<soapenv:Body><p:FindDataBox><p:dbOwnerInfo><p:ic>' + cleanIco + '</p:ic></p:dbOwnerInfo></p:FindDataBox></soapenv:Body></soapenv:Envelope>';
        const auth = 'Basic ' + Buffer.from(c.login + ':' + c.password).toString('base64');
        const xml = await doFetch(c.url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': 'FindDataBox', 'Authorization': auth },
            body: soapBody
        });
        const ids = [...String(xml).matchAll(/<[^>]*dbID>([^<]+)<\/[^>]*dbID>/g)].map(m => m[1].trim()).filter(Boolean);
        const nameM = String(xml).match(/<[^>]*firmName>([^<]+)<\/[^>]*firmName>/);
        const subjectName = nameM ? nameM[1].trim() : null;
        if (ids.length === 1) {
            return { available: true, configured: true, found: true, dataBoxId: ids[0], subjectName };
        }
        if (ids.length > 1) {
            return { available: true, configured: true, found: false, ambiguous: true, candidates: ids, subjectName };
        }
        return { available: true, configured: true, found: false };
    } catch (e) {
        return { available: false, configured: true, error: 'Dotaz do ISDS selhal: ' + e.message };
    }
}

// Vrátí konfiguraci pro UI — URL ano, KLÍČ nikdy celý (jen hasKey).
function getRegistryConfig() {
    const mk = (uKey, uEnv, kKey, kEnv) => ({
        url: _regSetting(uKey, uEnv),
        hasKey: !!_regSetting(kKey, kEnv)
    });
    return {
        cee: mk('registry_cee_url', 'CEE_API_URL', 'registry_cee_key', 'CEE_API_KEY'),
        katastr: mk('registry_katastr_url', 'KATASTR_API_URL', 'registry_katastr_key', 'KATASTR_API_KEY'),
        isds: {
            url: _regSetting('registry_isds_url', 'ISDS_WS_URL'),
            login: _regSetting('registry_isds_login', 'ISDS_LOGIN'),
            hasPassword: !!_regSetting('registry_isds_password', 'ISDS_PASSWORD')
        }
    };
}
// Uloží konfiguraci. Prázdný klíč = ponech stávající (nemaže); prázdné URL = smaž (fallback).
function setRegistryConfig(input) {
    input = input || {};
    const set = (obj, uKey, kKey) => {
        if (!obj) return;
        if (typeof obj.url === 'string') _saveSetting(uKey, obj.url.trim());
        if (typeof obj.key === 'string' && obj.key.trim() !== '') _saveSetting(kKey, obj.key.trim());
    };
    set(input.cee, 'registry_cee_url', 'registry_cee_key');
    set(input.katastr, 'registry_katastr_url', 'registry_katastr_key');
    if (input.isds) {
        if (typeof input.isds.url === 'string') _saveSetting('registry_isds_url', input.isds.url.trim());
        if (typeof input.isds.login === 'string') _saveSetting('registry_isds_login', input.isds.login.trim());
        if (typeof input.isds.password === 'string' && input.isds.password.trim() !== '') _saveSetting('registry_isds_password', input.isds.password.trim());
    }
    return getRegistryConfig();
}

module.exports = { checkSubject, checkCee, checkKatastr, findDataBox, isIsdsConfigured, getRegistryConfig, setRegistryConfig };
