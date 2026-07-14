/**
 * LexisLocal Registries Utility
 * Directly queries Czech public registries:
 * 1. ARES REST API (Ministry of Finance) for company name and official seat.
 * 2. ISIR SOAP Web Service (Ministry of Justice) for active insolvency check.
 */

const https = require('https');

// Demo/testovací fixtures (smyšlené subjekty) jsou aktivní jen v demo/test režimu.
// V produkci se i tato IČO dotazují reálných registrů — nikdy nevracíme
// fabrikovaná data jako ověřená.
const DEMO_FIXTURES = process.env.LEXIS_DEMO === '1' || process.env.NODE_ENV === 'test';

/**
 * Robust native HTTPS helper to avoid extra external package dependencies
 */
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

module.exports = { checkSubject };
