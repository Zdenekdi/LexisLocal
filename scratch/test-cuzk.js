const https = require('https');

function fetchUrl(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const requestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: 5000
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
            reject(new Error('Timeout'));
        });

        req.on('error', (err) => reject(err));

        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

async function checkIsirCuzk(ico) {
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

    try {
        const xmlResponse = await fetchUrl(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml;charset=UTF-8',
                'SOAPAction': ''
            },
            body: soapBody
        });
        
        console.log("=== RAW XML RESPONSE ===");
        console.log(xmlResponse);
        
        const hasInsolvency = xmlResponse.includes('<urlDetailRizeni>');
        if (hasInsolvency) {
            return {
                inInsolvency: true,
                caseNumber: "Detekováno v ISIR",
                status: "Aktivní insolvence"
            };
        }
        
        return { inInsolvency: false };
    } catch (e) {
        console.error("ISIR Cuzk Error:", e.message);
        return { inInsolvency: false, error: e.message };
    }
}

async function run() {
    // Test with Google Czech Republic (should not be in insolvency)
    console.log("Dotazuji Google (27604977)...");
    const resGoogle = await checkIsirCuzk("27604977");
    console.log("Výsledek Google:", resGoogle);
    
    // Test with a dummy ICO known to be in insolvency from mock data or try a real bankrupted entity if you want
    // But since this is a real-time check, let's see if Google returned successfully.
}

run();
