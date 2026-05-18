const fs = require('fs');
const pdf = require('pdf-parse');

const pdfPath = './LexisLocal - Komplexní Projektový Návrh.pdf';

const dataBuffer = fs.readFileSync(pdfPath);
pdf(dataBuffer).then(function(data) {
    fs.writeFileSync('./pdf_content.txt', data.text, 'utf-8');
    console.log("PDF TEXT EXTRACTED SUCCESSFULLY to pdf_content.txt! Length:", data.text.length);
}).catch(err => {
    console.error("Failed to parse PDF:", err);
});
