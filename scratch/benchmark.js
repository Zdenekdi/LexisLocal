const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { performance } = require('perf_hooks');

const dir = path.join(__dirname, 'bench_files');
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
}

// Create 50 files of 1MB
const filePaths = [];
for (let i = 0; i < 50; i++) {
    const filePath = path.join(dir, `file_${i}.txt`);
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, crypto.randomBytes(1024 * 1024).toString('hex')); // 2MB string
    }
    filePaths.push(filePath);
}

async function runBenchmark() {
    console.log("Starting synchronous benchmark...");
    const startSync = performance.now();
    for (const filePath of filePaths) {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf-8');
            // Mocking pdf parsing or further processing
        }
    }
    const endSync = performance.now();
    console.log(`Synchronous: ${endSync - startSync} ms`);

    console.log("Starting asynchronous benchmark...");
    const startAsync = performance.now();
    for (const filePath of filePaths) {
        try {
            await fsPromises.access(filePath);
            const data = await fsPromises.readFile(filePath, 'utf-8');
        } catch(e) {}
    }
    const endAsync = performance.now();
    console.log(`Asynchronous: ${endAsync - startAsync} ms`);

    console.log("Starting asynchronous Promise.all benchmark...");
    const startAsyncAll = performance.now();
    await Promise.all(filePaths.map(async (filePath) => {
        try {
            await fsPromises.access(filePath);
            const data = await fsPromises.readFile(filePath, 'utf-8');
        } catch(e) {}
    }));
    const endAsyncAll = performance.now();
    console.log(`Asynchronous Promise.all: ${endAsyncAll - startAsyncAll} ms`);
}

runBenchmark().catch(console.error);
