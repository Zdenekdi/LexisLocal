const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const crypto = require('crypto');
const fsPromises = require('fs').promises;

// Mock PDF Parser
const mockPdfParser = async (buffer) => {
    // Simulate some work
    await new Promise(resolve => setTimeout(resolve, 5));
    return { text: "Mocked PDF Content" };
};

const benchFiles = [];
for (let i = 0; i < 500; i++) {
    const isPdf = i % 2 === 0;
    const ext = isPdf ? '.pdf' : '.txt';
    benchFiles.push({
        fileName: `file_${i}${ext}`,
        filePath: `mock/file_${i}${ext}`, // We don't actually read from disk for the mock test here, we'll create real ones below
    });
}

const dir = path.join(__dirname, 'mock_bench');
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
}

const realBenchFiles = [];
for (let i = 0; i < 100; i++) {
    const isPdf = i % 2 === 0;
    const ext = isPdf ? '.pdf' : '.txt';
    const filePath = path.join(dir, `file_${i}${ext}`);
    fs.writeFileSync(filePath, crypto.randomBytes(100 * 1024).toString('hex')); // 200KB files
    realBenchFiles.push({
        fileName: `file_${i}${ext}`,
        filePath: filePath,
    });
}

async function runSync() {
    let successCount = 0;
    const start = performance.now();
    for (const file of realBenchFiles) {
        if (file.filePath && fs.existsSync(file.filePath)) {
            let content = "";
            const ext = path.extname(file.filePath).toLowerCase();
            try {
                if (ext === '.pdf') {
                    const dataBuffer = fs.readFileSync(file.filePath);
                    const parsedPdf = await mockPdfParser(dataBuffer);
                    content = parsedPdf.text;
                } else {
                    content = fs.readFileSync(file.filePath, 'utf-8');
                }
                if (content && content.trim()) {
                    successCount++;
                }
            } catch (err) {}
        }
    }
    return performance.now() - start;
}

async function runAsync() {
    let successCount = 0;
    const start = performance.now();
    for (const file of realBenchFiles) {
        if (file.filePath) {
            try {
                await fsPromises.access(file.filePath);
                let content = "";
                const ext = path.extname(file.filePath).toLowerCase();
                try {
                    if (ext === '.pdf') {
                        const dataBuffer = await fsPromises.readFile(file.filePath);
                        const parsedPdf = await mockPdfParser(dataBuffer);
                        content = parsedPdf.text;
                    } else {
                        content = await fsPromises.readFile(file.filePath, 'utf-8');
                    }
                    if (content && content.trim()) {
                        successCount++;
                    }
                } catch (err) {}
            } catch (e) {} // Not exists
        }
    }
    return performance.now() - start;
}

async function runAsyncConcurrent() {
    let successCount = 0;
    const start = performance.now();

    // Concurrency limit to simulate typical production workloads to prevent maxing out file descriptors
    const limit = 10;
    const processFile = async (file) => {
        if (!file.filePath) return;
        try {
            await fsPromises.access(file.filePath);
            let content = "";
            const ext = path.extname(file.filePath).toLowerCase();
            if (ext === '.pdf') {
                const dataBuffer = await fsPromises.readFile(file.filePath);
                const parsedPdf = await mockPdfParser(dataBuffer);
                content = parsedPdf.text;
            } else {
                content = await fsPromises.readFile(file.filePath, 'utf-8');
            }
            if (content && content.trim()) {
                successCount++;
            }
        } catch(e) {}
    }

    // Simple batching
    for (let i = 0; i < realBenchFiles.length; i += limit) {
        const batch = realBenchFiles.slice(i, i + limit);
        await Promise.all(batch.map(processFile));
    }

    return performance.now() - start;
}

async function runAll() {
    console.log("Warming up...");
    await runSync();
    await runAsync();
    await runAsyncConcurrent();

    console.log("Running benchmarks...");
    let syncTotal = 0, asyncTotal = 0, asyncConcurrentTotal = 0;
    const runs = 5;
    for (let i = 0; i < runs; i++) {
        syncTotal += await runSync();
        asyncTotal += await runAsync();
        asyncConcurrentTotal += await runAsyncConcurrent();
    }

    console.log(`Sync (baseline): ${syncTotal / runs} ms`);
    console.log(`Async (sequential): ${asyncTotal / runs} ms`);
    console.log(`Async (concurrent batching): ${asyncConcurrentTotal / runs} ms`);
}

runAll().catch(console.error);
