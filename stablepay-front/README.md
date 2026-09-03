# StablePay — Frontend

Part of the [StablePay](../README.md) monorepo — see the root README for full-stack setup.

Next.js 16 frontend for StablePay. Provides the client-facing UI for creating escrows, tracking milestones, and managing wallet connections.

## What it does

- Connects to users' wallets via RainbowKit
- Reads live escrow and milestone state directly from the blockchain
- Role-based UI: buyers create and fund escrows, sellers submit work, the platform resolves disputes
- Authenticates write operations using wallet signatures (no passwords or sessions)
- Polls on-chain state every 5 seconds alongside the backend API for a consistent view

## Tech Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **wagmi** + **viem** — Ethereum state and transactions
- **@tanstack/react-query** — caching layer required by wagmi's hooks
- **RainbowKit** — wallet connection UI
- **Tailwind CSS v4** — styling
- **lucide-react** — icons

## Structure

```
src/
├── abi/          # Contract ABI JSON files
├── app/          # Next.js App Router pages
├── components/   # Shared, dashboard, admin, and landing components
├── hooks/        # useUser, useFactoryConfig
├── lib/          # Auth helper, constants, formatters, validation
├── services/     # HTTP calls to the backend API
└── types/        # TypeScript interfaces (Escrow, Milestone, User)
```

## Environment Variables

```bash
NEXT_PUBLIC_FACTORY_ADDRESS=""
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=""
NEXT_PUBLIC_USDC_ADDRESS=""
NEXT_PUBLIC_PLATFORM_ADDRESS=""
NEXT_PUBLIC_BASESCAN_URL=""
```
`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is required — the app fails to start without it (free at [cloud.reown.com](https://cloud.reown.com/)). 

`NEXT_PUBLIC_PLATFORM_ADDRESS` is optional — leave it blank to try the app; only `/admin` routes need it. 
`NEXT_PUBLIC_BASESCAN_URL` is optional — used for "View on Basescan" links; defaults to `https://sepolia.basescan.org` if left unset.

## Run locally

Requires Node.js 20+ and the backend running (see [stablepay-back](../stablepay-back/README.md)).

```bash
cd stablepay-front
cp .env.example .env        # fill in the values — see comments inside the file
npm install
npm run dev                 # http://localhost:3000
```
