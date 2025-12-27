# Required Infrastructure & API Keys for Arc Subscriptions

To move from the prototype to a fully functional application, you will need the following accounts and keys:

## 1. Blockchain Access (RPC)
*   **Provider:** Alchemy (Provided)
*   **URL:** `https://arc-testnet.g.alchemy.com/v2/jpcQ1LqU0BqGhQvz7oeoW9rrcovJx3x_`

## 2. Account Abstraction (AA) Stack
*   **Bundler/Paymaster API:** Pimlico (Provided)
*   **Key:** `pim_V2cp4b4fQ6JTt5yKxBq2vm`

## 3. Automation (Relayer)
*   **Service:** A task runner or cron service.
    *   *Recommended:* **Gelato** (if Arc-enabled) or a custom server (AWS/Vercel).
    *   *Secret Needed:* A `RELAYER_PRIVATE_KEY` for a dedicated bot wallet that holds a small amount of gas (if not using a Paymaster for everything).

## 4. Wallet Connectivity
*   **Provider:** Privy (Provided)
*   **App ID:** `cmjjznob500ixl70ccj9jgolp`

## 5. Deployment Secrets (.env)
You will need a `.env` file with:
```bash
DEPLOYER_PRIVATE_KEY="0x..." # To deploy the SubscriptionManager
ARC_TESTNET_RPC_URL="https://rpc.testnet.arc.network"
USDC_ADDRESS="0x3600000000000000000000000000000000000000"
PIMLICO_API_KEY="your-api-key"
```

## Summary Checklist
- [ ] Create a **Circle** account (for USYC/stablecoin info).
- [ ] Get a **Pimlico** or **ZeroDev** API key.
- [ ] Get an **Alchemy** or **QuickNode** RPC key for Arc.
- [ ] Fund a testnet wallet with USDC from the [Circle Faucet](https://faucet.circle.com).
