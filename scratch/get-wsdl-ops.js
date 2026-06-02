const https = require('https');

https.get('https://isir.justice.cz:8443/isir_public_ws/IsirWsPublicService?wsdl', (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        console.log("=== Operations ===");
        const lines = data.split('\n');
        for (const line of lines) {
            if (line.includes('<operation name=') || line.includes('<message name=')) {
                console.log(line.trim());
            }
        }
    });
}).on('error', (e) => {
    console.error("WSDL Fetch Error:", e);
});
