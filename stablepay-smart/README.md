# StablePay — Smart Contracts

Part of the [StablePay](../README.md) monorepo — see the root README for full-stack setup.

Solidity smart contracts for StablePay. Implements the milestone-based escrow logic, deployed on Base (L2 Ethereum).

## What it does

- Locks buyer funds in escrow per milestone, released only when the buyer approves
- Deducts a 2.5% platform fee on approval, plus an additional 1% if the milestone went through dispute resolution
- Lets the seller auto-claim payment after 14 days if the buyer takes no action
- Lets either party open a dispute, which the platform resolves by splitting the milestone amount between buyer and seller
- Gives the seller a correction window to resubmit work before a dispute escalates
- Refunds the buyer in full if a dispute stays unresolved after 30 days

## Tech Stack

- **Solidity 0.8.28** + **Foundry** (forge, cast, anvil)
- **OpenZeppelin** — reentrancy protection and safe ERC-20 transfers
- **Target network:** Base Sepolia (testnet)

## Contracts

**`EscrowFactory`** — deployed once. Manages the token whitelist, platform fee, and timer defaults. Deploys new `StablePayEscrow` instances.

**`StablePayEscrow`** — one contract per project. Handles the full payment lifecycle: seller acceptance, funding, milestone submissions, approvals, disputes, and refunds. Settings are locked at construction time.

## Milestone Status Flow

```
PENDING ─┬─→ SUBMITTED ─┬─→ PAID       (approved or auto-approved after 14 days)
         │              ├─→ DISPUTED ─┬─→ RESOLVED  (split between buyer and seller)
         │              │             ├─→ PAID      (seller awarded 100%)
         │              │             ├─→ REFUNDED  (buyer awarded 100%, or dispute timeout)
         │              │             └─→ SUBMITTED (resubmit — buyer-opened disputes only)
         └─→ REFUNDED   (buyer cancels before seller submits)
```

## Fee Structure

- **Approval (normal or auto-approval):** 2.5% platform fee deducted from the seller's payout
- **Dispute resolution:** 1% dispute fee taken off the top of the milestone amount first — plus the 2.5% platform fee on the seller's share if the seller is awarded anything
- **Dispute timeout / buyer awarded 100%:** only the 1% dispute fee applies — no 2.5% fee, since the seller gets nothing

## Deployed Addresses (Base Sepolia)

| Contract | Address |
|---|---|
| `EscrowFactory` | [`0x43f38b20bc9d10a0e0d58812bb30d6676003f97e`](https://sepolia.basescan.org/address/0x43f38b20bc9d10a0e0d58812bb30d6676003f97e) |
| `USDC` (approved) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

## Run Tests & Build

Requires [Foundry](https://book.getfoundry.sh/getting-started/installation):

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

The libraries (forge-std, OpenZeppelin) are git submodules under `lib/`. Clone with `--recurse-submodules`, or fetch them in an existing clone:

```bash
git submodule update --init --recursive
```

```bash
forge test        # 109 tests across 13 test contracts
forge test -vvv   # verbose output
forge build
```

Deployed via `forge script` (never manually) and verified on Basescan — see [`CONTRACT_SUMMARY.md`](./CONTRACT_SUMMARY.md) for full deploy steps.
