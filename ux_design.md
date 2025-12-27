# User Experience (UX) Design: Arc Subscriptions

The goal of Phase 4 is to make the onchain subscription feel as seamless as a traditional credit card payment.

## 1. Onboarding Flow (The "Web2" Experience)
Instead of asking for a seed phrase, the application uses **Account Abstraction** to simplify onboarding:

1.  **Social/Passkey Login:** User clicks "Sign in with Google" or uses FaceID (Passkey). Behind the scenes, a Smart Account is created but not yet deployed (counterfactual).
2.  **Plan Selection:** User picks a $15/month subscription tier.
3.  **One-Click Authorization:** 
    *   The user signs a single transaction.
    *   This transaction does three things in one "Bundle" (via ERC-4337):
        1. Deploys the Smart Account.
        2. Approves the `SubscriptionManager` for USDC usage.
        3. Creates the `Subscription` and authorizes the `Session Key`.

## 2. Dashboard Interface
*   **Status Card:** "Active / Next payment in 12 days."
*   **Transaction History:** Shows all previous "Pull" payments with links to `arcscan.app`.
*   **Revoke Button:** "Cancel Subscription." This immediate revoke is possible onchain by cancelling the session key or cancelling in the contract.

## 3. The "Silent" Renewal
After the first month, the user never visits the site again to pay.
*   **The Relayer** triggers the task.
*   **The Paymaster** pays the gas.
*   **The User** simply receives an email/notification: "Your monthly Arc subscription has been renewed."
