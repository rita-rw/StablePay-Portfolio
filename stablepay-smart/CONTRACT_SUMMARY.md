# StablePay Smart Contracts — Summary

> A reference document for the team. Read this to understand what we built,
> in what order, and how the contract logic works.
> Last updated: August 2026

---

## What We Built

A milestone-based escrow system for B2B payments on Base (L2 Ethereum).
Instead of paying upfront and hoping for delivery, the buyer locks money in a
smart contract. The money releases automatically, milestone by milestone, as
work is approved.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        EscrowFactory                         │
│  • One factory, deployed once                                │
│  • Creates new escrow contracts (one per project)            │
│  • Manages which tokens are allowed (USDC whitelist)         │
│  • Controls platform fee (default 2.5%)                      │
│  • Controls auto-approval days (default 14)                  │
│  • Controls dispute timeout days (default 30)                │
│  • Tracks all escrows by buyer and by seller                 │
└──────────────────────────────────────────────────────────────┘
                               │
                               │  buyer calls createEscrow()
                               │  → factory deploys a new contract
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                      StablePayEscrow                         │
│  • One contract per project                                  │
│  • Holds the USDC until milestones are resolved              │
│  • Manages the milestone flow (submit → approve → pay)       │
│  • Handles disputes with a correction window                 │
│  • Has safety mechanisms if buyer or platform go inactive    │
└──────────────────────────────────────────────────────────────┘
```

---

## The Three Roles

| Role | Who | What they can do |
|------|-----|-----------------|
| **Buyer** | The company paying | Create escrow, fund it, approve milestones, open disputes, cancel |
| **Seller** | The company delivering | Submit milestones, resubmit during disputes, claim auto-approval, open disputes |
| **Platform** | StablePay (us) | Resolve disputes, manage token whitelist, change fee and config |

---

## How We Built It — In Order

### Phase 1 — Basic Factory + Escrow Structure
- Created `EscrowFactory.sol` with token whitelist and `createEscrow()`
- Created `StablePayEscrow.sol` with the basic flow: `fund()`, `submitMilestone()`, `approveMilestone()`
- Added `ReentrancyGuard` and `SafeERC20` from OpenZeppelin from day one

### Phase 2 — Dispute Flow
- Added `openDispute()`, `resolveDispute()` to the escrow
- Platform fee and dispute fee both charged from sellerAward (later fixed — see audit)

### Phase 3 — Internal Audit (9 findings, all resolved)

We ran an internal audit and found 9 issues. All were fixed before continuing:

| # | Severity | Problem | Fix |
|---|----------|---------|-----|
| 1 | Critical | Funded escrow could be locked forever (no refund mechanism) | Added `cancelEscrow()` — refunds all PENDING milestones |
| 2 | Critical | Seller stuck forever if buyer ghosts after submission | Added `claimAutoApproval()` — seller claims after 14 days |
| 3 | High | Platform earned more by siding with seller in disputes | Fixed dispute math — 1% dispute fee taken from pot first, then split |
| 4 | High | Factory tracking arrays were internal — no way to read them | Added `getEscrowsByBuyer()`, `getEscrowsBySeller()`, `getAllEscrows()`, `getEscrowCount()` |
| 5 | Medium | Seller could be `address(0)` — payments burned forever | Added `InvalidSeller` check in `createEscrow()` |
| 6 | Medium | No milestone limit — gas attack possible on loops | Added `MAX_MILESTONES = 50` cap |
| 7 | Medium | No way to tell a normal payout from a dispute payout | Added `RESOLVED` as a 6th milestone status |
| 8 | Low | Unused struct fields (`buyerApproved`, `sellerApproved`) wasting gas | Removed both fields from the struct |
| 9 | Low | Fee-on-transfer tokens would break accounting | Added NatSpec warning — handle via token whitelist |

### Phase 4 — Feature Sprint (3 parallel branches)

After the audit, the team split into 3 branches:

**Person A — Fee frontrunning protection + deploy config**
- Added `maxFeeBps` parameter to `createEscrow()` — buyer declares the max fee they accept
- If platform raises fee between page load and transaction mining, the tx reverts (not silently overcharged)
- Pinned Solidity compiler to `0.8.28` in `foundry.toml`
- Wrote `.env.example` template
- Rewrote deploy script with mainnet safety block and auto USDC approval

**Person B — Seller correction window during disputes**
- Added `resubmitDuringDispute()` — seller can fix and resubmit within a correction window (originally fixed at 7 days)
- Platform is blocked from resolving during the correction window
- After resubmit, normal flow resumes (buyer can approve or dispute again)

**Person C — Dispute timeout protection**
- Added `claimDisputeTimeout()` — if platform doesn't resolve within 30 days, buyer or seller can trigger a timeout
- Buyer gets refund minus 1% dispute fee — safety net against inactive or malicious platform

**Final test count (team phase): 81 tests, all passing**

### Since Then — Solo Maintenance

- 28 additional tests written solo after the team phase ended (**109 tests total**, across 13 test contracts)
- The correction window was refactored from a fixed 7-day constant into a configurable factory-level setting (`defaultCorrectionWindowDays`, 0–30 days, **default: 7 days**), locked per-escrow at creation. See the Timers and Constants sections below for the current behavior.

---

## Milestone State Machine

Each milestone starts as PENDING and moves through states based on who does what.

```
PENDING
  │
  │  seller calls submitMilestone()
  ▼
SUBMITTED
  │
  ├──── buyer calls approveMilestone() ──────────────────→ PAID
  │
  ├──── 14 days pass, seller calls claimAutoApproval() ──→ PAID
  │
  └──── buyer or seller calls openDispute()
          │
          ▼
       DISPUTED
          │
          ├── seller resubmits within the correction window (buyer-opened only) → back to SUBMITTED
          │
          ├── platform calls resolveDispute() after the correction window elapses
          │     ├── seller gets 100%  → PAID
          │     ├── buyer gets 100%   → REFUNDED
          │     └── both get some     → RESOLVED
          │
          └── 30 days pass, anyone calls claimDisputeTimeout() → REFUNDED
```

**Status values (as stored on-chain):**
`0=PENDING  1=SUBMITTED  2=DISPUTED  3=PAID  4=REFUNDED  5=RESOLVED`

---

## EscrowFactory — Functions

### Admin functions (only platform can call)

| Function | What it does |
|----------|-------------|
| `approveToken(token)` | Adds a token to the whitelist (e.g. USDC) |
| `removeToken(token)` | Removes a token from the whitelist |
| `setPlatformFeeBps(newFee)` | Changes the fee (max 10% = 1000 bps) |
| `setDefaultAutoApprovalDays(days)` | Changes auto-approval period (1–90 days) |
| `setDefaultDisputeTimeoutDays(days)` | Changes dispute timeout period (14–180 days) |
| `setDefaultCorrectionWindowDays(days)` | Changes correction window period (0–30 days) |

### Buyer function

| Function | What it does |
|----------|-------------|
| `createEscrow(seller, token, milestoneAmounts, metadataHash, maxFeeBps)` | Deploys a new escrow contract. Returns the escrow address. |

### Read functions (anyone, no gas cost)

| Function | Returns |
|----------|---------|
| `getEscrowsByBuyer(address)` | All escrows where this address is the buyer |
| `getEscrowsBySeller(address)` | All escrows where this address is the seller |
| `getAllEscrows()` | Every escrow ever created |
| `getEscrowCount()` | Total number of escrows |
| `isValidEscrow(address)` | True if this address was created by this factory |
| `platformFeeBps()` | Current fee in basis points |
| `approvedTokens(address)` | True if this token is whitelisted |

---

## StablePayEscrow — Functions

| Function | Who | What it does |
|----------|-----|-------------|
| `fund()` | Buyer | Deposits total USDC. Must `approve()` the escrow first. |
| `submitMilestone(index, hash)` | Seller | Marks milestone as submitted with delivery proof hash |
| `approveMilestone(index)` | Buyer | Releases funds to seller (2.5% fee to platform) |
| `openDispute(index, reason)` | Buyer or Seller | Moves milestone to DISPUTED |
| `resubmitDuringDispute(index, hash)` | Seller | Resets disputed milestone back to SUBMITTED (only within the correction window, only if buyer opened) |
| `resolveDispute(index, sellerAward)` | Platform | Splits funds. Only after the correction window elapses if buyer opened the dispute. |
| `claimAutoApproval(index)` | Seller | Claims payment if buyer hasn't responded in 14 days |
| `claimDisputeTimeout(index)` | Buyer or Seller | Triggers refund if platform hasn't resolved in 30 days |
| `cancelEscrow()` | Buyer | Cancels escrow and refunds all PENDING milestones. Reverts if any milestone is SUBMITTED or DISPUTED. |

---

## Fee Structure

All fees are in basis points. 100 bps = 1%.

| Scenario | Platform fee | Dispute fee | Example (1000 USDC milestone) |
|----------|-------------|-------------|-------------------------------|
| Normal approval | 2.5% of milestone | — | Seller gets 975, Platform gets 25 |
| Auto-approval | 2.5% of milestone | — | Same as normal |
| Dispute → seller wins 100% | 2.5% of seller award | 1% of total | Dispute fee: 10 → Seller award: 990 → Platform fee: 24.75 → Seller net: 965.25 |
| Dispute → buyer wins 100% | — | 1% of total | Buyer gets 990, Platform gets 10 |
| Dispute → 50/50 split | 2.5% of seller portion | 1% of total | Dispute fee: 10 → remaining 990 → each 495 → seller pays 12.38 fee |
| Dispute timeout | — | — | Buyer gets 1000, Platform gets 0 |

**Key rule:** The 1% dispute fee always comes out of the total pot first — before any split.
The 2.5% platform fee only applies to what the seller receives.
This means the platform earns the same dispute fee regardless of who wins.
On dispute timeout the platform did not resolve, so it takes no fee at all.

---

## Timers

| Timer | Duration | Starts when | What can happen |
|-------|----------|-------------|----------------|
| Auto-approval | 14 days (configurable 1–90) | Seller submits a milestone | Seller can call `claimAutoApproval()` if buyer never acts |
| Correction window | Configurable per factory, 0–30 days (**default: 7 days**) | Buyer opens a dispute | Seller can resubmit corrected work during the window. Platform cannot resolve until it elapses. Locked in per-escrow at creation. |
| Dispute timeout | 30 days (configurable 14–180) | Dispute is opened | Either party can call `claimDisputeTimeout()` — buyer gets the full refund |

---

## Security Measures

| Protection | How |
|-----------|-----|
| Reentrancy attacks | `ReentrancyGuard` on all functions that transfer tokens |
| Unsafe token transfers | `SafeERC20` from OpenZeppelin on all token operations |
| Scam tokens | Token whitelist — only platform-approved tokens can be used |
| Fee frontrunning | `maxFeeBps` parameter in `createEscrow()` — tx reverts if fee was raised |
| Buyer ghosting seller | Auto-approval after 14 days |
| Platform ghosting dispute | Dispute timeout after 30 days |
| Funds locked forever | `cancelEscrow()` refunds PENDING milestones |
| Gas attacks via milestone loops | `MAX_MILESTONES = 50` cap |
| Seller being address(0) | `InvalidSeller` check — prevents burning payments |

---

## Constants & Limits

| Constant | Value | Meaning |
|----------|-------|---------|
| `MAX_FEE_BPS` | 1000 | Max platform fee is 10% |
| `DISPUTE_FEE_BPS` | 100 | Arbitration fee is always 1% |
| `MAX_CORRECTION_WINDOW_DAYS` | 30 | Longest allowed correction window (no minimum — 0 is valid and disables it) |
| `MAX_MILESTONES` | 50 | Max milestones per escrow |
| `MIN_AUTO_APPROVAL_DAYS` | 1 | Shortest allowed auto-approval period |
| `MAX_AUTO_APPROVAL_DAYS` | 90 | Longest allowed auto-approval period |
| `MIN_DISPUTE_TIMEOUT_DAYS` | 14 | Shortest allowed dispute timeout |
| `MAX_DISPUTE_TIMEOUT_DAYS` | 180 | Longest allowed dispute timeout |

---

## Testnet Info

| Item | Value |
|------|-------|
| Network | Base Sepolia |
| Chain ID | 84532 |
| USDC address | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Block explorer | https://sepolia.basescan.org |

---

## Running the Contracts Locally

```bash
# Install dependencies
forge install

# Build
forge build

# Run all tests (114 tests)
forge test

# Deploy to Base Sepolia
cp .env.example .env
# Fill in: PLATFORM_ADDRESS, RPC_URL, PRIVATE_KEY (deploy wallet, not PLATFORM), ETHERSCAN_API_KEY
source .env
forge script script/DeployStablePayEscrow.s.sol:DeployStablePayEscrow \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify
```

After deploy, approve USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e` on Base Sepolia) in Admin Settings while connected with the PLATFORM wallet — `approveToken` is `onlyPlatform`, so the deploy script cannot do it.
