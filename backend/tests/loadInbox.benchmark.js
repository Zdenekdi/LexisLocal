const fs = require('fs');
const path = require('path');

const WATCH_DIR = path.join(process.cwd(), 'benchmark_temp');
const INBOX_PATH = path.join(WATCH_DIR, '.inbox.json');

// Ensure a dummy inbox exists
if (!fs.existsSync(WATCH_DIR)) {
    fs.mkdirSync(WATCH_DIR, { recursive: true });
}

// Create a relatively large dummy inbox
const dummyInbox = { files: {} };
for (let i = 0; i < 10000; i++) {
    dummyInbox.files[`file_${i}.pdf`] = {
        fileName: `file_${i}.pdf`,
        status: "unread",
        caseNumber: "123 C 456/2023",
        plaintiff: "Plaintiff " + i,
        defendant: "Defendant " + i,
    };
}
fs.writeFileSync(INBOX_PATH, JSON.stringify(dummyInbox));

// Old loadInbox (Sync)
function loadInboxSync() {
    try {
        if (fs.existsSync(INBOX_PATH)) {
            return JSON.parse(fs.readFileSync(INBOX_PATH, 'utf-8'));
        }
    } catch (e) {
    }
    return { files: {} };
}

// New loadInbox (Async)
async function loadInboxAsync() {
    try {
        const data = await fs.promises.readFile(INBOX_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
    }
    return { files: {} };
}

async function runBenchmark() {
    console.log("Starting concurrency benchmark...");
    const numRequests = 20; // smaller number of requests to avoid running out of memory and get more stable numbers

    console.log("--- Testing Sync ---");
    let startSync = Date.now();
    let syncPromises = [];

    // Check Event Loop delay WHILE Sync calls are executing
    let syncDelays = [];

    // Start interval timer, which is more reliable for checking event loop blocking
    const syncInterval = setInterval(() => {
        syncDelays.push(Date.now());
    }, 10);

    for (let i = 0; i < numRequests; i++) {
        syncPromises.push(new Promise(resolve => {
            setTimeout(() => {
                 loadInboxSync();
                 resolve();
            }, 0); // They all get scheduled at 0, which means Node will try to execute them in sequence right away
        }));
    }

    await Promise.all(syncPromises);
    clearInterval(syncInterval);

    // calculate max gap between syncDelays
    let maxSyncGap = 0;
    if (syncDelays.length > 0) {
        maxSyncGap = syncDelays[0] - startSync; // The time before the first interval fired
        for(let i = 1; i < syncDelays.length; i++) {
            let gap = syncDelays[i] - syncDelays[i-1] - 10; // subtract 10 for expected interval
            if(gap > maxSyncGap) maxSyncGap = gap;
        }
    } else {
        // If the interval never fired, the block was the entire duration
        maxSyncGap = Date.now() - startSync;
    }

    console.log(`Max Event loop block during Sync execution: ${maxSyncGap} ms`);
    console.log(`Total wall time (Sync): ${Date.now() - startSync} ms`);


    console.log("--- Testing Async ---");
    let startAsync = Date.now();
    let asyncPromises = [];

    let asyncDelays = [];

    const asyncInterval = setInterval(() => {
        asyncDelays.push(Date.now());
    }, 10);

    for (let i = 0; i < numRequests; i++) {
        asyncPromises.push(new Promise(resolve => {
             setTimeout(async () => {
                 await loadInboxAsync();
                 resolve();
            }, 0);
        }));
    }

    await Promise.all(asyncPromises);
    clearInterval(asyncInterval);

    // calculate max gap between asyncDelays
    let maxAsyncGap = 0;
    if (asyncDelays.length > 0) {
        maxAsyncGap = asyncDelays[0] - startAsync;
        for(let i = 1; i < asyncDelays.length; i++) {
            let gap = asyncDelays[i] - asyncDelays[i-1] - 10;
            if(gap > maxAsyncGap) maxAsyncGap = gap;
        }
    } else {
        maxAsyncGap = Date.now() - startAsync;
    }

    console.log(`Max Event loop block during Async execution: ${maxAsyncGap} ms`);
    console.log(`Total wall time (Async): ${Date.now() - startAsync} ms`);

    // Cleanup
    fs.unlinkSync(INBOX_PATH);
    fs.rmdirSync(WATCH_DIR);

    process.exit(0);
}

runBenchmark().catch(console.error);
