const https = require('https');

https.get('https://isir.justice.cz:8443/isir_cuzk_ws/IsirWsCuzkService?xsd=isirWsCuzkTypes.xsd', (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        console.log("=== Cuzk XSD Types ===");
        const lines = data.split('\n');
        for (let i = 0; i < Math.min(lines.length, 100); i++) {
            console.log(lines[i]);
        }
    });
}).on('error', (e) => {
    console.error("XSD Fetch Error:", e);
});
