require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

async function main() {
    const rpcUrl = process.env.ARC_RPC_URL;
    const privateKey = process.env.PRIVATE_KEY;
    const contractAddress = process.env.SUBSCRIPTION_MANAGER_ADDRESS;

    if (!rpcUrl || !privateKey || !contractAddress) {
        console.error('Please set ARC_RPC_URL, PRIVATE_KEY, and SUBSCRIPTION_MANAGER_ADDRESS in .env');
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    const artifactPath = path.resolve(__dirname, '../out/SubscriptionManager.json');
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const contract = new ethers.Contract(contractAddress, artifact.abi, wallet);

    console.log(`Initializing tiers for contract at ${contractAddress}...`);

    const TEST_FREQUENCY = 600; // 10 minutes
    const tiers = [
        { name: "Basic", amount: ethers.parseUnits("1", 6), frequency: TEST_FREQUENCY },
        { name: "Pro", amount: ethers.parseUnits("2", 6), frequency: TEST_FREQUENCY },
        { name: "Enterprise", amount: ethers.parseUnits("3", 6), frequency: TEST_FREQUENCY }
    ];

    for (const tier of tiers) {
        console.log(`Adding tier: ${tier.name} ($${ethers.formatUnits(tier.amount, 6)})...`);
        const tx = await contract.addTier(tier.name, tier.amount, tier.frequency);
        await tx.wait();
        console.log(`Tier ${tier.name} added.`);
    }

    console.log("All tiers successfully initialized.");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
