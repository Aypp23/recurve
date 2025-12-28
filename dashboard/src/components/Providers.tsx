"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";

export default function Providers({ children }: { children: React.ReactNode }) {
    return (
        <PrivyProvider
            appId="cmjjznob500ixl70ccj9jgolp"
            config={{
                // Customize Privy's appearance and login methods
                appearance: {
                    theme: "light",
                    accentColor: "#004D40",
                    // Logo is set in Privy Dashboard instead of code
                },
                // Enable email, wallet, Google, and passkey logins
                loginMethods: ["email", "wallet", "google", "passkey"],
                // Specific for Arc Network
                supportedChains: [{
                    id: 5042002,
                    name: 'Arc Testnet',
                    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
                    rpcUrls: { default: { http: ['https://arc-testnet.g.alchemy.com/v2/jpcQ1LqU0BqGhQvz7oeoW9rrcovJx3x_'] } }
                }],
                defaultChain: {
                    id: 5042002,
                    name: 'Arc Testnet',
                    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
                    rpcUrls: { default: { http: ['https://arc-testnet.g.alchemy.com/v2/jpcQ1LqU0BqGhQvz7oeoW9rrcovJx3x_'] } }
                },
                embeddedWallets: {
                    ethereum: {
                        createOnLogin: 'all-users',
                    }
                },
            }}
        >
            <SmartWalletsProvider>
                {children}
            </SmartWalletsProvider>
        </PrivyProvider>
    );
}
