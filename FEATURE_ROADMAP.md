# ArcPay Feature Roadmap

A comprehensive list of features inspired by Stripe Billing that can enhance ArcPay's subscription protocol.

---

## 🚀 Tier 1: High Impact / Core Features

| Feature | Description | Priority |
|---------|-------------|----------|
| **Trial Periods** | Allow users to try a subscription for X days before being charged. Add `trialEnd` timestamp to subscriptions. | ⭐⭐⭐ |
| **Subscription Pausing** | Let users pause their subscription (stops billing) instead of cancelling. Resume later. | ⭐⭐⭐ |
| **Usage-Based Billing** | Charge based on API calls, storage, etc. Record usage and bill at end of period. | ⭐⭐⭐ |
| **Smart Retries** | If payment fails, automatically retry at optimal times before marking as failed. | ⭐⭐⭐ |
| **Proration** | When switching plans mid-cycle, calculate and apply prorated credits/charges. | ⭐⭐ |

---

## 🎨 Tier 2: User Experience Enhancements

| Feature | Description | Priority |
|---------|-------------|----------|
| **Grace Periods** | Give users a few days after failed payment before cancelling. | ⭐⭐ |
| **Per-Seat Pricing** | Subscriptions for "5 team members" instead of single tier. | ⭐⭐ |
| **Invoices/Receipts** | Generate downloadable receipts for accounting. | ⭐⭐ |
| **Multiple Payment Methods** | Allow backup token address if primary balance insufficient. | ⭐ |
| **Coupons & Discounts** | Promo codes for X% off or $Y off a subscription. | ⭐⭐ |
| **Tiered Pricing** | Volume discounts: "First 100 calls at $0.01, next 1000 at $0.005". | ⭐ |

---

## 🛠️ Tier 3: Platform/Developer Features

| Feature | Description | Priority |
|---------|-------------|----------|
| **Webhooks** | HTTP callbacks when events occur (created, paid, cancelled). | ⭐⭐⭐ |
| **Multi-Merchant (Connect)** | Let other businesses use your infra and receive payments. Take platform fee. | ⭐⭐ |
| **Customer Portal** | Hosted page where customers self-manage subscriptions. | ⭐⭐ |
| **Entitlements** | Track feature access based on subscription tier. | ⭐ |

---

## 📦 Developer Distribution Strategies

### 1. JavaScript/TypeScript SDK (Recommended First)

Create an `npm` package (`@arcpay/sdk`) wrapping contract interactions:

```typescript
import { ArcPay } from '@arcpay/sdk';

const arcpay = new ArcPay({ rpcUrl: '...', contractAddress: '...' });

// Create subscription
const subId = await arcpay.createSubscription(userWallet, tierId);

// Check status
const isActive = await arcpay.isActive(subId);
```

**Key Components:**
- Typed interfaces for subscriptions, tiers, events
- Helper functions for common operations
- Provider-agnostic (ethers, viem, wagmi)

---

### 2. REST API (For Web2 Developers)

Backend service exposing contract via HTTP:

```
POST /api/subscriptions        - Create subscription
GET  /api/subscriptions/:id    - Get details
GET  /api/users/:addr/subs     - List user subscriptions
POST /api/webhooks             - Register webhook
```

Allows Web2 devs to integrate without Solidity knowledge.

---

### 3. Embeddable Widget (No-Code)

Like Stripe Checkout buttons:

```html
<script src="https://arcpay.io/widget.js"></script>
<arcpay-button tier="1" merchant="0x..."></arcpay-button>
```

Click → Modal → Connect Wallet → Subscribe. Zero code required.

---

## 📊 Recommended Implementation Order

1. **Immediate**: Trial Periods + Proration
2. **Short-Term**: JavaScript SDK + Webhooks
3. **Medium-Term**: Usage-Based Billing + Multi-Merchant
4. **Long-Term**: Embeddable Widget + REST API
