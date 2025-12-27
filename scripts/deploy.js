require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

async function main() {
    const rpcUrl = process.env.ARC_RPC_URL;
    const privateKey = process.env.PRIVATE_KEY;

    if (!rpcUrl || !privateKey) {
        console.error('Please set ARC_RPC_URL and PRIVATE_KEY in .env');
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log('Deploying from:', wallet.address);

    const artifactPath = path.resolve(__dirname, '../out/SubscriptionManager.json');
    if (!fs.existsSync(artifactPath)) {
        console.error('Artifact not found. Please run compile.js first.');
        process.exit(1);
    }

    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

    console.log('Deploying SubscriptionManager...');
    const usdcAddress = "0x3600000000000000000000000000000000000000";
    const contract = await factory.deploy(usdcAddress);
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    console.log('SubscriptionManager deployed to:', address);

    // Update .env with the new address
    const envPath = path.resolve(__dirname, '../.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    envContent = envContent.replace(/SUBSCRIPTION_MANAGER_ADDRESS=".*"/, `SUBSCRIPTION_MANAGER_ADDRESS="${address}"`);
    fs.writeFileSync(envPath, envContent);

    console.log('Updated .env with the contract address.');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
