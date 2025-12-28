require('dotenv').config();
const { ethers } = require("ethers");
const fs = require('fs');
const path = require('path');
const http = require('http');

// Health server for Render/UptimeRobot (keeps free tier alive)
const PORT = process.env.PORT || 10000;
let lastCheck = null;
let isHealthy = true;

const healthServer = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: isHealthy ? 'ok' : 'error',
            service: 'recurve-relayer',
            lastCheck: lastCheck,
            uptime: process.uptime()
        }));
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

healthServer.listen(PORT, () => {
    console.log(`🏥 Health server running on port ${PORT}`);
});

// Configuration from .env
const RPC_URL = process.env.ARC_RPC_URL;
const MANAGER_ADDRESS = process.env.SUBSCRIPTION_MANAGER_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!RPC_URL || !MANAGER_ADDRESS || !PRIVATE_KEY) {
    console.error("Please ensure .env is populated with ARC_RPC_URL, SUBSCRIPTION_MANAGER_ADDRESS, and PRIVATE_KEY");
    process.exit(1);
}

// Fallback RPC Support
const RPC_URLS = [
    RPC_URL,
    "https://rpc.testnet.arc.network/" // Public fallback (supports 10k+ block ranges)
];

// Smart Retry Configuration
const RETRY_DELAYS = [
    1 * 60 * 60,      // 1 hour
    6 * 60 * 60,      // 6 hours
    24 * 60 * 60,     // 24 hours
    3 * 24 * 60 * 60, // 3 days
];
const MAX_RETRIES = RETRY_DELAYS.length;

// File paths
const LAST_BLOCK_FILE = path.resolve(__dirname, '../.relayer_last_block');
const SUBS_FILE = path.resolve(__dirname, '../scripts/subscriptions.json');
const FAILED_FILE = path.resolve(__dirname, '../scripts/failed_payments.json');
const DEPLOYMENT_BLOCK = 18080000;

async function getProvider() {
    for (const url of RPC_URLS) {
        try {
            console.log(`Connecting to RPC: ${url}...`);
            const provider = new ethers.JsonRpcProvider(url);
            await provider.getNetwork();
            return provider;
        } catch (e) {
            console.warn(`Failed to connect to ${url}: ${e.message.split('(')[0]}`);
        }
    }
    throw new Error("All RPC endpoints failed.");
}

function loadFailedPayments() {
    if (fs.existsSync(FAILED_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(FAILED_FILE, 'utf8'));
        } catch (e) {
            console.error("Error reading failed_payments.json:", e.message);
        }
    }
    return {};
}

function saveFailedPayments(data) {
    fs.writeFileSync(FAILED_FILE, JSON.stringify(data, null, 2));
}

function recordFailure(failedPayments, subId, reason) {
    const now = Math.floor(Date.now() / 1000);
    const existing = failedPayments[subId] || { failCount: 0 };
    const failCount = existing.failCount + 1;

    if (failCount > MAX_RETRIES) {
        console.log(`🚨 CHURNED: ${subId.slice(0, 10)}... (exceeded ${MAX_RETRIES} retries)`);
        failedPayments[subId] = { ...existing, failCount, status: 'churned', lastAttempt: now };
    } else {
        const delay = RETRY_DELAYS[failCount - 1];
        const nextRetry = now + delay;
        console.log(`⏰ Retry #${failCount} scheduled for ${new Date(nextRetry * 1000).toLocaleString()}`);
        failedPayments[subId] = {
            failCount,
            lastAttempt: now,
            nextRetry,
            reason: reason.slice(0, 100)
        };
    }
    saveFailedPayments(failedPayments);
}

function clearFailure(failedPayments, subId) {
    if (failedPayments[subId]) {
        console.log(`✅ Cleared from retry queue: ${subId.slice(0, 10)}...`);
        delete failedPayments[subId];
        saveFailedPayments(failedPayments);
    }
}

async function runRelayer() {
    const provider = await getProvider();
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    const abi = [
        "function executePayment(bytes32 _subId)",
        "function getTierCount() view returns (uint256)",
        "function checkUpkeep(bytes32[] calldata _subIds) external view returns (bytes32[] memory)",
        "event SubscriptionCreated(bytes32 indexed subId, address indexed subscriber, uint256 tierId)",
        "event SubscriptionPaid(bytes32 indexed subId, uint256 amount, uint256 timestamp)"
    ];

    const contract = new ethers.Contract(MANAGER_ADDRESS, abi, wallet);
    const failedPayments = loadFailedPayments();
    const now = Math.floor(Date.now() / 1000);

    console.log(`\n--- Relayer Check: ${new Date().toLocaleString()} ---`);
    lastCheck = new Date().toISOString();
    isHealthy = true;

    // ===================
    // SMART RETRIES: Check failed payments first
    // ===================
    const retryQueue = Object.entries(failedPayments).filter(
        ([_, data]) => data.status !== 'churned' && data.nextRetry <= now
    );

    if (retryQueue.length > 0) {
        console.log(`🔄 Retrying ${retryQueue.length} failed payment(s)...`);
        for (const [subId, data] of retryQueue) {
            process.stdout.write(`- Retry #${data.failCount + 1} for ${subId.slice(0, 10)}... `);
            try {
                const tx = await contract.executePayment(subId);
                console.log(`SUCCESS! Hash: ${tx.hash}`);
                clearFailure(failedPayments, subId);
            } catch (error) {
                console.log(`FAILED: ${error.message.split('(')[0]}`);
                recordFailure(failedPayments, subId, error.message);
            }
        }
    }

    // ===================
    // Load subscriptions
    // ===================
    let startBlock = DEPLOYMENT_BLOCK;
    if (fs.existsSync(LAST_BLOCK_FILE)) {
        startBlock = parseInt(fs.readFileSync(LAST_BLOCK_FILE, 'utf8'));
    }

    let subIdsToWatch = [];
    if (fs.existsSync(SUBS_FILE)) {
        try {
            subIdsToWatch = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
        } catch (e) {
            console.error("Error reading subscriptions.json:", e.message);
        }
    }

    // ===================
    // BATCH CHECK: Check all known subscriptions
    // ===================
    if (subIdsToWatch.length > 0) {
        console.log(`Checking ${subIdsToWatch.length} known subscriptions via checkUpkeep...`);
        try {
            const dueIds = await contract.checkUpkeep(subIdsToWatch);

            if (dueIds.length > 0) {
                console.log(`⚡ Found ${dueIds.length} due subscriptions! Executing payments...`);
                for (const subId of dueIds) {
                    // Skip if already in retry queue (don't double-attempt)
                    if (failedPayments[subId] && failedPayments[subId].nextRetry > now) {
                        continue;
                    }

                    process.stdout.write(`- Paying Sub ${subId.slice(0, 10)}... `);
                    try {
                        const tx = await contract.executePayment(subId);
                        console.log(`SUCCESS! Hash: ${tx.hash}`);
                        clearFailure(failedPayments, subId);
                    } catch (error) {
                        console.log(`FAILED: ${error.message.split('(')[0]}`);
                        recordFailure(failedPayments, subId, error.message);
                    }
                }
            } else {
                console.log(`✅ All subscriptions up to date.`);
            }
        } catch (e) {
            console.error("Method checkUpkeep failed:", e.message.slice(0, 100));
        }
    }

    // ===================
    // SCAN: Look for new subscriptions (10-block chunks for Alchemy free tier)
    // ===================
    let currentBlock = await provider.getBlockNumber();

    // If no saved block, start from recent (not from deployment block which is too far back)
    if (startBlock < currentBlock - 1000) {
        startBlock = currentBlock - 100; // Start from last 100 blocks
        console.log(`Starting fresh scan from block ${startBlock}`);
    }

    if (startBlock > currentBlock) {
        console.log(`No new blocks to scan.`);
        return;
    }

    console.log(`Scanning blocks ${startBlock} to ${currentBlock} for new events...`);

    const CHUNK_SIZE = 10;
    for (let i = startBlock; i <= currentBlock; i += CHUNK_SIZE) {
        const toBlock = Math.min(i + CHUNK_SIZE - 1, currentBlock);
        try {
            const filter = contract.filters.SubscriptionCreated();
            const events = await contract.queryFilter(filter, i, toBlock);
            if (events.length > 0) {
                const discoveredIds = events.map(e => e.args.subId);
                console.log(`  Found ${discoveredIds.length} new sub(s) at block ${i}`);
                subIdsToWatch = [...new Set([...subIdsToWatch, ...discoveredIds])];
                fs.writeFileSync(SUBS_FILE, JSON.stringify(subIdsToWatch, null, 2));
            }
            fs.writeFileSync(LAST_BLOCK_FILE, (toBlock + 1).toString());
        } catch (e) {
            console.error(`  Scan Error at ${i}: ${e.message.split('(')[0]}`);
            break;
        }
    }

    // Log retry queue status
    const pendingRetries = Object.values(failedPayments).filter(d => d.status !== 'churned').length;
    const churnedCount = Object.values(failedPayments).filter(d => d.status === 'churned').length;
    if (pendingRetries > 0 || churnedCount > 0) {
        console.log(`📊 Retry Queue: ${pendingRetries} pending, ${churnedCount} churned`);
    }
}

// Check every 60 seconds with robustness
async function main() {
    try {
        await runRelayer();
    } catch (err) {
        console.error("Relayer crashed:", err.message);
    }
    setTimeout(main, 60000);
}

main();
