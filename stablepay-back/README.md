# StablePay — Backend

Part of the [StablePay](../README.md) monorepo — see the root README for full-stack setup.

Express + TypeScript backend for StablePay. Acts as a database mirror of on-chain escrow state, extended with off-chain metadata (project titles, delivery references, dispute reasons) that cannot be stored on-chain cheaply.

## What it does

- Listens to 14 on-chain events in real time and syncs them to the database
- Exposes a REST API for the frontend (projects, users, milestones, events)
- Authenticates write operations by verifying wallet signatures server-side
- Sends email notifications on key events (new project, dispute opened, etc.)
- Exposes `/health` and `/ready` endpoints so the listener's status can be monitored — used by Railway to detect and auto-restart a broken listener

## Tech Stack

- **Express** + **TypeScript**
- **Prisma** + **PostgreSQL** — database ORM and storage
- **viem** — blockchain reads and event listening
- **Zod** — request validation
- **Nodemailer** — transactional email notifications
- **cors** + **express-rate-limit** — origin allowlist and per-endpoint rate limiting

## Structure

```
src/
├── abi/           # Contract ABI definitions (read/write functions, events)
├── controllers/   # Route handlers (projects, users, admin)
├── middleware/    # Zod validation middleware
├── routes/        # Express route definitions
├── services/      # Prisma DB operations (escrow, milestone, user)
├── utils/         # Sanitization, constants, blockchain clients (read + signing)
├── validators/    # Zod request schemas
├── app.ts         # Express app setup — CORS, rate limiting, routes, health checks
├── auth.ts        # Wallet signature verification middleware
├── index.ts       # Entry point — starts the server and the blockchain listener
├── listener.ts    # Blockchain event listener + DB sync
├── mailer.ts      # Email notifications
└── prisma.ts      # Prisma client instance
```

## Environment Variables

```bash
DATABASE_URL=
RPC_URL=
RPC_URL_FALLBACK=
FACTORY_ADDRESS=
FACTORY_DEPLOY_BLOCK=
PORT=
PLATFORM_ADDRESS=
PRIVATE_KEY=
ALLOWED_ORIGINS=
```

## Run locally

Requires Node.js 20+, Docker (for PostgreSQL), and a Base Sepolia RPC URL (e.g. from [Alchemy](https://www.alchemy.com/)).

```bash
cd stablepay-back
docker-compose up -d        # starts PostgreSQL
cp .env.example .env        # fill in the values — see comments inside the file
npm install
npx prisma generate
npx prisma migrate dev
npm run dev                 # http://localhost:3001
```

`PLATFORM_ADDRESS` and `PRIVATE_KEY` belong to the platform admin wallet — leave them blank to try the app. Buyer/seller flows (create, fund, submit, approve) work fully without them, since those transactions are signed by each user's own wallet in the browser. Only the `/admin` routes (dispute resolution, platform settings) require them.
