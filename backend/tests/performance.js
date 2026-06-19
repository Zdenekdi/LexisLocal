const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');

// Create a dummy PDF file (we just need a large file with .pdf extension)
const dummyPdfPath = path.join(__dirname, 'dummy.pdf');
const sizeInMB = 50;
const buffer = crypto.randomBytes(sizeInMB * 1024 * 1024);
fs.writeFileSync(dummyPdfPath, buffer);

const RUNS = 100;

async function runSync() {
    console.time('Sync Read');
    const start = process.hrtime.bigint();
    for (let i = 0; i < RUNS; i++) {
        const dataBuffer = fs.readFileSync(dummyPdfPath);
        // emulate some parsing step using length just to prevent optimization removal
        const len = dataBuffer.length;
    }
    const end = process.hrtime.bigint();
    console.timeEnd('Sync Read');
    return Number(end - start) / 1000000;
}

async function runAsync() {
    console.time('Async Read');
    const start = process.hrtime.bigint();
    const promises = [];
    for (let i = 0; i < RUNS; i++) {
        promises.push(fs.promises.readFile(dummyPdfPath).then(dataBuffer => dataBuffer.length));
    }
    await Promise.all(promises);
    const end = process.hrtime.bigint();
    console.timeEnd('Async Read');
    return Number(end - start) / 1000000;
}

async function testEventLoopBlockSync() {
    let count = 0;
    const interval = setInterval(() => { count++; }, 10);

    console.time('Event Loop Sync Blocking');
    for (let i = 0; i < RUNS; i++) {
        const dataBuffer = fs.readFileSync(dummyPdfPath);
    }
    console.timeEnd('Event Loop Sync Blocking');

    clearInterval(interval);
    return count;
}

async function testEventLoopBlockAsync() {
    let count = 0;
    const interval = setInterval(() => { count++; }, 10);

    console.time('Event Loop Async Non-Blocking');
    const promises = [];
    for (let i = 0; i < RUNS; i++) {
        promises.push(fs.promises.readFile(dummyPdfPath));
    }
    await Promise.all(promises);
    console.timeEnd('Event Loop Async Non-Blocking');

    clearInterval(interval);
    return count;
}

async function runTest() {
    console.log(`Running benchmark with ${RUNS} iterations on a ${sizeInMB}MB file...`);

    // warm up
    fs.readFileSync(dummyPdfPath);
    await fs.promises.readFile(dummyPdfPath);

    const syncBlocks = await testEventLoopBlockSync();
    const asyncBlocks = await testEventLoopBlockAsync();

    console.log(`Intervals fired during sync read: ${syncBlocks} (fewer is worse - indicates event loop blocking)`);
    console.log(`Intervals fired during async read: ${asyncBlocks} (more is better - indicates event loop is free)`);

    // Cleanup
    fs.unlinkSync(dummyPdfPath);
}

runTest().catch(console.error);
