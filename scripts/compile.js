const fs = require('fs');
const path = require('path');
const solc = require('solc');

function findImports(importPath) {
    if (importPath.startsWith('@openzeppelin/')) {
        return {
            contents: fs.readFileSync(path.resolve(__dirname, '../node_modules', importPath), 'utf8')
        };
    }
    return { error: 'File not found' };
}

const contractPath = path.resolve(__dirname, '../contracts/SubscriptionManager.sol');
const source = fs.readFileSync(contractPath, 'utf8');

const input = {
    language: 'Solidity',
    sources: {
        'SubscriptionManager.sol': {
            content: source
        }
    },
    settings: {
        outputSelection: {
            '*': {
                '*': ['*']
            }
        },
        optimizer: {
            enabled: true,
            runs: 200
        }
    }
};

console.log('Compiling...');
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

if (output.errors) {
    output.errors.forEach(err => {
        console.error(err.formattedMessage);
    });
}

const contract = output.contracts['SubscriptionManager.sol']['SubscriptionManager'];

const dir = path.resolve(__dirname, '../out');
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
}

fs.writeFileSync(
    path.resolve(dir, 'SubscriptionManager.json'),
    JSON.stringify({
        abi: contract.abi,
        bytecode: contract.evm.bytecode.object
    }, null, 2)
);

console.log('Compilation successful. Output saved to /out/SubscriptionManager.json');
