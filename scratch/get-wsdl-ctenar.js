const https = require('https');

https.get('https://isir.justice.cz:8443/isir_ws/services/IsirWsCtenar?wsdl', (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        console.log("=== WSDL IsirWsCtenar (First 1000 chars) ===");
        console.log(data.substring(0, 1000));
    });
}).on('error', (e) => {
    console.error("WSDL Fetch Error:", e);
});
