require('dotenv').config();
const { ethers } = require('ethers');

async function main() {
    const rpcUrl = process.env.ARC_RPC_URL;
    const privateKey = process.env.PRIVATE_KEY;
    const contractAddress = process.env.SUBSCRIPTION_MANAGER_ADDRESS;

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(
        contractAddress,
        ["function grantRole(bytes32 role, address account) public", "function RELAYER_ROLE() view returns (bytes32)"],
        wallet
    );

    const relayerAddress = wallet.address; // Using same address for now
    const relayerRole = await contract.RELAYER_ROLE();

    console.log(`Granting RELAYER_ROLE to ${relayerAddress}...`);
    const tx = await contract.grantRole(relayerRole, relayerAddress);
    await tx.wait();
    console.log('Role granted successfully.');
}

main().catch(console.error);
