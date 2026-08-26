# StablePay

A milestone-based escrow platform built on Base, a Layer-2 Ethereum blockchain. Clients and freelancers agree on project milestones upfront — funds are locked in a smart contract and released only when each milestone is approved. Disputes are resolved by the platform, with built-in timeouts and protection mechanisms for both parties.

Started as a team internship project; actively developed and maintained solo since then — see [`PROJECT_HISTORY.md`](PROJECT_HISTORY.md) for what that's involved.

---

## What it does

- **Buyers** create an escrow contract, define milestones with USDC amounts, and fund the contract
- **Sellers** accept the project, submit proof of delivery per milestone, and receive payment on approval
- **Disputes** escalate to a platform admin who can split the milestone payment between both parties
- All on-chain activity is synced to a backend database and surfaced in a real-time UI — every transaction is publicly verifiable on-chain (see contract addresses below)

---

## Tech Stack

| Layer | Technologies |
|---|---|
| Smart contracts | Solidity 0.8.28, Foundry, OpenZeppelin |
| Blockchain | Base (L2 Ethereum), USDC (ERC-20) |
| Backend | Node.js, Express, TypeScript, Prisma, PostgreSQL, viem |
| Frontend | Next.js 16, React 19, TypeScript, wagmi, viem, RainbowKit, Tailwind CSS v4 |
| Auth | Stateless wallet signature verification (no sessions or passwords) |

---

## Architecture

```
stablepay-smart/    Solidity smart contracts (EscrowFactory + StablePayEscrow)
stablepay-back/     Express + PostgreSQL backend — blockchain listener + REST API
stablepay-front/    Next.js frontend — wallet-based login UI, with separate views for buyers, sellers, and admins
```

The smart contracts are the source of truth. The backend listens to 14 on-chain events and mirrors state to a database, adding off-chain metadata (titles, delivery references, dispute reasons). The frontend reads directly from both the chain and the backend.

---

## Key Features

- **Milestone escrow** — funds locked per milestone, released only on approval
- **Auto-approval** — seller can claim payment after 14 days if the buyer does not act
- **Dispute resolution** — platform can split a milestone between buyer and seller
- **Correction window** — buyer-opened disputes give the seller a window to resubmit before escalation
- **Dispute timeout** — either party can trigger a full buyer refund after 30 days of inactivity
- **Email notifications** — sent on key events (new project, dispute opened, milestone approved, etc.)
- **Role-based UI** — separate views for buyers, sellers, and platform admins

---

## Smart Contract: Escrow Lifecycle

```
createEscrow()  →  [seller accepts / rejects]
                        ↓ accepted
                   fund()  →  submitMilestone()  →  approveMilestone()  →  PAID
                                                  →  openDispute()
                                                         ↓
                                                   resolveDispute()  →  RESOLVED / PAID / REFUNDED
```

---

## Deployed (Base Sepolia Testnet)

| | Address |
|---|---|
| EscrowFactory | [`0x43f38b20bc9d10a0e0d58812bb30d6676003f97e`](https://sepolia.basescan.org/address/0x43f38b20bc9d10a0e0d58812bb30d6676003f97e) |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Block explorer | [sepolia.basescan.org](https://sepolia.basescan.org) |

---

## Run Locally

Requires Node.js 20+, Docker (for PostgreSQL), and a Base Sepolia RPC URL (e.g. from [Alchemy](https://www.alchemy.com/)).

**1. Backend**
```bash
cd stablepay-back
docker-compose up -d        # starts PostgreSQL
cp .env.example .env        # fill in the values — see comments inside the file
npm install
npx prisma migrate dev
npm run dev                 # http://localhost:3001
```

`PLATFORM_ADDRESS` and `PRIVATE_KEY` belong to the platform admin wallet — leave them blank to try the app. Buyer/seller flows (create, fund, submit, approve) work fully without them, since those transactions are signed by each user's own wallet in the browser. Only the `/admin` routes (dispute resolution, platform settings) require them.

**2. Frontend**
```bash
cd stablepay-front
npm install
# set NEXT_PUBLIC_API_URL, NEXT_PUBLIC_FACTORY_ADDRESS, etc. — see stablepay-front/README.md
npm run dev                 # http://localhost:3000
```

The smart contracts are already deployed to Base Sepolia (addresses above) — the backend and frontend point at them directly, no deployment needed to run the app locally. To work on the contracts themselves (`forge test`, `forge build`), see [`stablepay-smart/README.md`](stablepay-smart/README.md).

Full environment variable lists and per-service details: [`stablepay-back/README.md`](stablepay-back/README.md) · [`stablepay-front/README.md`](stablepay-front/README.md) · [`stablepay-smart/README.md`](stablepay-smart/README.md)

---

## License

[MIT](LICENSE)
