/**
 * LexisLocal Registries Utility
 * Directly queries Czech public registries:
 * 1. ARES REST API (Ministry of Finance) for company name and official seat.
 * 2. ISIR SOAP Web Service (Ministry of Justice) for active insolvency check.
 */

const https = require('https');

/**
 * Robust native HTTPS helper to avoid extra external package dependencies
 */
function fetchUrl(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const requestOptions = {
            hostname: urlObj.hostname,
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
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
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
    try {
        const url = `https://ares.gov.cz/ekonomicke-subjekty-vzd/rest/ekonomicke-subjekty/${ico}`;
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
    try {
        const url = 'https://isir.justice.cz/isir_ws/services/IsirPub001';
        const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:typ="http://isirws.novell.com/types">
   <soapenv:Header/>
   <soapenv:Body>
      <typ:getIsirWsPub001Request>
         <ico>${ico}</ico>
      </typ:getIsirWsPub001Request>
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
        const hasInsolvency = xmlResponse.includes('<spisovaZnacka>');
        if (hasInsolvency) {
            const matchCase = xmlResponse.match(/<spisovaZnacka>([^<]+)<\/spisovaZnacka>/);
            const matchStatus = xmlResponse.match(/<stavRizeni>([^<]+)<\/stavRizeni>/);
            return {
                inInsolvency: true,
                caseNumber: matchCase ? matchCase[1].replace(/\s+/g, ' ').trim() : "Aktivní insolvenční spis",
                status: matchStatus ? matchStatus[1].replace(/\s+/g, ' ').trim() : "Probíhající řízení"
            };
        }
        
        return { inInsolvency: false };
    } catch (e) {
        console.warn(`⚠️ Chyba ISIR pro IČO ${ico}:`, e.message);
        return { inInsolvency: false };
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
        name: ares ? ares.name : "Subjekt nenalezen v ARES",
        seat: ares ? ares.seat : "Adresa nezjištěna",
        inInsolvency: isir.inInsolvency,
        insolvencyCase: isir.caseNumber || null,
        insolvencyStatus: isir.status || null,
        verifiedAt: new Date().toISOString()
    };
}

module.exports = { checkSubject };
