# Recurve

**On-chain subscription payments powered by smart accounts on Arc Network.**
link: arcrecurve.vercel.app
Recurve enables seamless, recurring crypto payments using smart account technology. Users authorize once, and the relayer automatically processes payments on schedule.

## Features

- 🔄 **Recurring Payments** - Automated subscription billing
- 💳 **Smart Account Vaults** - Secure, user-controlled payment wallets
- ⚡ **Prorated Upgrades/Downgrades** - Fair billing for plan changes
- 🔐 **Non-custodial** - Users control their funds
- 📊 **Real-time Dashboard** - Manage subscriptions easily

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Dashboard     │────▶│  Smart Account  │────▶│ Subscription    │
│   (Next.js)     │     │  (Privy + AA)   │     │ Manager Contract│
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         ▲
                                                         │
                                               ┌─────────────────┐
                                               │    Relayer      │
                                               │  (Auto-billing) │
                                               └─────────────────┘
```

## Tech Stack

- **Frontend**: Next.js 16, React, TailwindCSS
- **Wallet**: Privy (embedded wallets + social login)
- **Smart Accounts**: Pimlico (ERC-4337)
- **Blockchain**: Arc Network Testnet
- **Smart Contract**: Solidity

## Quick Start

### 1. Install Dependencies

```bash
npm install
cd dashboard && npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Fill in your keys
```

### 3. Deploy Contracts

```bash
node scripts/compile.js
node scripts/deploy.js
node scripts/init_tiers.js
node scripts/grant_relayer.js
```

### 4. Start Services

```bash
# Dashboard
cd dashboard && npm run dev

# Relayer (in another terminal)
node scripts/relayer.js
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PRIVATE_KEY` | Deployer & relayer wallet |
| `SUBSCRIPTION_MANAGER_ADDRESS` | Deployed contract address |
| `ARC_RPC_URL` | Arc Network RPC endpoint |
| `PIMLICO_API_KEY` | Pimlico bundler API key |
| `PRIVY_APP_ID` | Privy application ID |

## License

MIT
