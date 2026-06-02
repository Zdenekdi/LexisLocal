const https = require('https');

https.get('https://isir.justice.cz/isir_ws/services/IsirWsCtenar?wsdl', (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        console.log("=== WSDL IsirWsCtenar 443 (First 1000 chars) ===");
        console.log(data.substring(0, 1000));
    });
}).on('error', (e) => {
    console.error("WSDL Fetch Error:", e);
});
