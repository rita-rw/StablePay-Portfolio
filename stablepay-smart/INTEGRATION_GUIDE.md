# StablePay Smart Contracts — Integration Guide

> Everything backend and frontend devs need to know before building on these contracts.
> Version: v1.0.0-beta | Network: Base Sepolia (testnet) | Token: USDC

---

## Quick Start

### Prerequisites

- [Foundry](https://book.getfoundry.sh/) installed (`curl -L https://foundry.paradigm.xyz | bash`)
- Git

### Clone & Build

```bash
git clone https://github.com/AMPDlabs/stablepay-smart.git
cd stablepay-smart
forge install
forge build
```

### Run Tests

```bash
forge test           # 81 tests, all passing
forge test -vvv      # verbose output (shows traces on failure)
```

### Deploy to Base Sepolia

```bash
cp .env.example .env
# Fill in: PLATFORM_ADDRESS, RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY

source .env
forge script script/DeployStablePayEscrow.s.sol:DeployStablePayEscrow \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify
```

The deploy script will:
- Block mainnet deploys (safety check)
- Deploy the `EscrowFactory` contract
- Approve USDC if `USDC_ADDRESS` is set in `.env`
- Print a deployment summary

---

## Architecture Overview

```
EscrowFactory (one per deployment)
  │
  ├── createEscrow() → deploys new StablePayEscrow
  ├── Token whitelist management
  ├── Platform fee config (2.5% default)
  ├── Auto-approval days config (14 days default)
  ├── Dispute timeout days config (30 days default)
  └── Escrow tracking (by buyer, by seller, all)

StablePayEscrow (one per project)
  │
  ├── fund() → buyer deposits USDC
  ├── submitMilestone() → seller delivers work
  ├── approveMilestone() → buyer releases payment
  ├── openDispute() → either party disputes
  ├── resubmitDuringDispute() → seller corrects work (7-day window)
  ├── resolveDispute() → platform splits funds
  ├── claimAutoApproval() → seller claims if buyer ghosts
  ├── claimDisputeTimeout() → either party claims if platform ghosts
  └── cancelEscrow() → buyer reclaims unstarted milestones
```

---

## Three Roles

| Role | Who | Can do |
|------|-----|--------|
| **Buyer** | The one paying (calls `createEscrow`) | Fund, approve milestones, open disputes, cancel escrow |
| **Seller** | The one delivering work | Submit milestones, resubmit during disputes, claim auto-approval, open disputes |
| **Platform** | StablePay (us) | Resolve disputes, manage token whitelist, change fee/config |

---

## Milestone State Machine

```
PENDING ──(seller submits)──→ SUBMITTED
                                  │
                    ┌─────────────┼─────────────┐
                    │             │              │
              (buyer approves) (auto-approval) (dispute opened)
                    │             │              │
                    ▼             ▼              ▼
                  PAID          PAID         DISPUTED
                                                │
                              ┌─────────────────┼──────────────────┐
                              │                 │                  │
                     (seller resubmits)  (platform resolves)  (timeout: 30 days)
                              │                 │                  │
                              ▼           ┌─────┼─────┐            ▼
                          SUBMITTED       │     │     │         REFUNDED
                                       PAID RESOLVED REFUNDED
```

**Status values (uint8):** 0=PENDING, 1=SUBMITTED, 2=DISPUTED, 3=PAID, 4=REFUNDED, 5=RESOLVED

---

## Contract ABIs — What Backend/Frontend Needs

### EscrowFactory

#### Write Functions (require transactions)

**`createEscrow(seller, token, milestoneAmounts, metadataHash, maxFeeBps)`**
- Called by: buyer
- Returns: address of new escrow contract
- `milestoneAmounts`: array of uint256, amounts in token wei (USDC has 6 decimals)
- `metadataHash`: bytes32, keccak256 hash of off-chain project details
- `maxFeeBps`: uint256, max fee the buyer accepts (protects against frontrunning). Pass current `platformFeeBps` or slightly higher.

```solidity
// Example: create escrow with 2 milestones of 1000 USDC each
uint256[] memory amounts = new uint256[](2);
amounts[0] = 1000e6; // 1000 USDC (6 decimals)
amounts[1] = 1000e6;

factory.createEscrow(
    sellerAddress,
    usdcAddress,
    amounts,
    keccak256(abi.encodePacked("project-123")),
    300  // accept up to 3% fee
);
```

**`approveToken(token)`** / **`removeToken(token)`** — Platform only

**`setPlatformFeeBps(newFeeBps)`** — Platform only, max 1000 (10%)

**`setDefaultAutoApprovalDays(newDays)`** — Platform only, range 1–90

**`setDefaultDisputeTimeoutDays(newDays)`** — Platform only, range 14–180

#### Read Functions (free, no gas)

| Function | Returns | Use for |
|----------|---------|---------|
| `getEscrowsByBuyer(address)` | `address[]` | Dashboard: "my projects as buyer" |
| `getEscrowsBySeller(address)` | `address[]` | Dashboard: "my projects as seller" |
| `getAllEscrows()` | `address[]` | Admin dashboard |
| `getEscrowCount()` | `uint256` | Stats |
| `isValidEscrow(address)` | `bool` | Verify an escrow was created by this factory |
| `platformFeeBps()` | `uint256` | Show current fee in UI |
| `defaultAutoApprovalDays()` | `uint256` | Show in escrow creation UI |
| `defaultDisputeTimeoutDays()` | `uint256` | Show in dispute UI |
| `approvedTokens(address)` | `bool` | Check if token is allowed |
| `PLATFORM()` | `address` | Platform wallet address |

### StablePayEscrow

#### Write Functions

| Function | Called by | When | What happens |
|----------|----------|------|--------------|
| `fund()` | Buyer | After creation | Buyer must first `USDC.approve(escrowAddress, totalAmount)`, then call `fund()`. Pulls `totalAmount` from buyer. |
| `submitMilestone(index, deliveryHash)` | Seller | After funding | Marks milestone as SUBMITTED. `deliveryHash` = keccak256 of delivery proof. |
| `approveMilestone(index)` | Buyer | After seller submits | Releases funds: seller gets amount minus 2.5% fee, platform gets fee. |
| `openDispute(index, reason)` | Buyer or Seller | After submission | Moves to DISPUTED. `reason` = bytes32 hash of dispute reason. |
| `resubmitDuringDispute(index, deliveryHash)` | Seller | Within 7 days of buyer-opened dispute | Moves back to SUBMITTED. Resets auto-approval timer. |
| `resolveDispute(index, sellerAward)` | Platform | After 7-day correction window (if buyer opened) | Splits funds. 1% dispute fee from total, then split remainder. |
| `claimAutoApproval(index)` | Seller | After AUTO_APPROVAL_DAYS since submission | Same payout as buyer approve. |
| `claimDisputeTimeout(index)` | Buyer or Seller | After DISPUTE_TIMEOUT_DAYS since dispute opened | Buyer gets refund minus 1% fee. |
| `cancelEscrow()` | Buyer | Any time (no active milestones) | Refunds all PENDING milestones. Reverts if any SUBMITTED/DISPUTED. |

#### Read Functions

| Function | Returns | Notes |
|----------|---------|-------|
| `BUYER()` | `address` | Immutable |
| `SELLER()` | `address` | Immutable |
| `PLATFORM()` | `address` | Immutable |
| `TOKEN()` | `address` | Payment token (USDC) |
| `FEE_BPS()` | `uint256` | Fee snapshot at creation (250 = 2.5%) |
| `AUTO_APPROVAL_DAYS()` | `uint256` | Snapshot at creation (default 14) |
| `DISPUTE_TIMEOUT_DAYS()` | `uint256` | Snapshot at creation (default 30) |
| `METADATA_HASH()` | `bytes32` | Project metadata hash |
| `funded()` | `bool` | Has buyer deposited? |
| `cancelled()` | `bool` | Has escrow been cancelled? |
| `totalAmount()` | `uint256` | Sum of all milestones |
| `milestoneCount()` | `uint256` | Number of milestones |
| `milestones(index)` | `(amount, status, deliveryHash, submittedAt, disputeReason, disputeOpenedAt, disputeOpenedBy)` | Full milestone data |
| `CORRECTION_WINDOW_DAYS()` | `uint256` | Always 7 (constant) |
| `DISPUTE_FEE_BPS()` | `uint256` | Always 100 = 1% (constant) |

---

## Events to Listen For

### Factory Events

```solidity
event EscrowCreated(
    address indexed escrow,     // new escrow contract address
    address indexed buyer,
    address indexed seller,
    address token,
    uint256 totalAmount,
    uint256 milestoneCount,
    bytes32 metadataHash
);

event TokenApprovalChanged(address indexed token, bool approved);
event PlatformFeeChanged(uint256 oldFeeBps, uint256 newFeeBps);
event DefaultAutoApprovalDaysChanged(uint256 oldDays, uint256 newDays);
event DefaultDisputeTimeoutDaysChanged(uint256 oldDays, uint256 newDays);
```

### Escrow Events

```solidity
// Happy path
event Funded(address indexed buyer, uint256 amount);
event MilestoneSubmitted(uint256 indexed milestoneIndex, bytes32 deliveryHash);
event MilestoneApproved(uint256 indexed milestoneIndex);

// Auto-approval (buyer ghosted)
event MilestoneAutoApproved(uint256 indexed milestoneIndex);

// Disputes
event DisputeOpened(uint256 indexed milestoneIndex, address indexed openedBy, bytes32 reason);
event MilestoneResubmitted(uint256 indexed milestoneIndex, bytes32 deliveryHash);
event DisputeResolved(
    uint256 indexed milestoneIndex,
    uint256 sellerAward,
    uint256 buyerAward,
    uint256 platformFee,
    uint256 disputeFee
);
event DisputeTimeoutClaimed(uint256 indexed milestoneIndex, uint256 buyerRefund, uint256 disputeFee);

// Cancel
event EscrowCancelled(address indexed buyer);
event MilestoneRefunded(uint256 indexed milestoneIndex, uint256 amount);
```

---

## Fee Structure

| Scenario | Platform fee | Dispute fee | Example (1000 USDC milestone) |
|----------|-------------|-------------|-------------------------------|
| Normal approval | 2.5% of amount | None | Seller: 975, Platform: 25 |
| Auto-approval | 2.5% of amount | None | Seller: 975, Platform: 25 |
| Dispute → seller gets all | 2.5% of sellerAward | 1% of total pot | Dispute fee: 10, Seller award: 990, Platform fee: 24.75, Seller net: 965.25, Platform total: 34.75 |
| Dispute → buyer gets all | None | 1% of total pot | Dispute fee: 10, Buyer: 990, Platform: 10 |
| Dispute → 50/50 split | 2.5% of sellerAward | 1% of total pot | Dispute fee: 10, Remaining: 990, Each gets 495, Seller fee: 12.375 |
| Dispute timeout | None | 1% of total pot | Buyer: 990, Platform: 10 |

**Key rule:** Dispute fee (1%) always comes from the total pot FIRST, then the remainder is split. Platform fee (2.5%) only applies to what the seller receives.

---

## Important Timers

| Timer | Duration | Starts when | What happens |
|-------|----------|-------------|--------------|
| **Auto-approval** | 14 days (configurable) | Seller submits milestone | Seller can call `claimAutoApproval()` if buyer hasn't approved/disputed |
| **Correction window** | 7 days (constant) | Buyer opens dispute | Seller can resubmit corrected work. Platform cannot resolve during this window. |
| **Dispute timeout** | 30 days (configurable) | Dispute is opened | Either party can call `claimDisputeTimeout()` — buyer gets refund minus 1% |

---

## Frontend Flow — What to Show

### Buyer creates project
1. UI: Show form (seller address, milestone amounts, metadata)
2. Read `platformFeeBps` from factory to show current fee
3. Call `factory.createEscrow(seller, usdc, amounts, hash, maxFeeBps)`
4. Listen for `EscrowCreated` event → get escrow address
5. UI: Show "Fund your escrow" button

### Buyer funds project
1. Call `USDC.approve(escrowAddress, totalAmount)` first
2. Then call `escrow.fund()`
3. Listen for `Funded` event

### Seller submits work
1. Call `escrow.submitMilestone(index, deliveryHash)`
2. Listen for `MilestoneSubmitted` event
3. UI: Show countdown for auto-approval (read `AUTO_APPROVAL_DAYS`)

### Buyer reviews
- **Approve:** Call `escrow.approveMilestone(index)` → listen for `MilestoneApproved`
- **Dispute:** Call `escrow.openDispute(index, reasonHash)` → listen for `DisputeOpened`

### During dispute (buyer opened)
- Show 7-day correction window countdown (`disputeOpenedAt + 7 days`)
- Seller sees: "Resubmit corrected work" button → `resubmitDuringDispute(index, newHash)`
- After 7 days: Platform can resolve via admin panel

### During dispute (seller opened)
- No correction window — platform can resolve immediately
- Platform admin panel: call `resolveDispute(index, sellerAward)`

### Timeout states
- **Auto-approval available:** Show "Claim payment" to seller when `block.timestamp >= submittedAt + AUTO_APPROVAL_DAYS * 86400`
- **Dispute timeout available:** Show "Claim timeout" when `block.timestamp >= disputeOpenedAt + DISPUTE_TIMEOUT_DAYS * 86400`

### Cancel escrow
- Buyer can cancel if no milestones are SUBMITTED or DISPUTED
- Call `escrow.cancelEscrow()` → listen for `EscrowCancelled` + `MilestoneRefunded` events

---

## Reading Escrow State (for Backend Indexing)

To build a dashboard, read all escrows from the factory and their state:

```javascript
// 1. Get all escrows for a user
const buyerEscrows = await factory.getEscrowsByBuyer(userAddress);
const sellerEscrows = await factory.getEscrowsBySeller(userAddress);

// 2. For each escrow, read its state
const escrow = new Contract(escrowAddress, escrowABI, provider);
const buyer = await escrow.BUYER();
const seller = await escrow.SELLER();
const funded = await escrow.funded();
const cancelled = await escrow.cancelled();
const milestoneCount = await escrow.milestoneCount();

// 3. Read each milestone
for (let i = 0; i < milestoneCount; i++) {
    const m = await escrow.milestones(i);
    // m.amount, m.status, m.deliveryHash, m.submittedAt,
    // m.disputeReason, m.disputeOpenedAt, m.disputeOpenedBy
}
```

**Tip:** For real-time updates, listen to events instead of polling. Each state change emits an event with the escrow address and milestone index.

---

## Base Sepolia Testnet Info

| Item | Value |
|------|-------|
| Chain ID | 84532 |
| RPC | `https://sepolia.base.org` |
| Block explorer | `https://sepolia.basescan.org` |
| USDC address | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Faucet (ETH) | `https://www.coinbase.com/faucets/base-ethereum-goerli-faucet` |

### Getting testnet USDC
Base Sepolia USDC is a mock contract. You can mint test tokens or use a faucet. Check the USDC contract on BaseScan for a `mint` function, or ask the team for test tokens.

---

## Constants & Limits

| Constant | Value | Where |
|----------|-------|-------|
| Max fee | 1000 bps (10%) | Factory |
| Default fee | 250 bps (2.5%) | Factory constructor |
| Dispute fee | 100 bps (1%) | Escrow constant |
| Correction window | 7 days | Escrow constant |
| Max milestones | 50 | Factory constant |
| Auto-approval range | 1–90 days | Factory constants |
| Dispute timeout range | 14–180 days | Factory constants |
| Default auto-approval | 14 days | Factory constructor |
| Default dispute timeout | 30 days | Factory constructor |

---

## Error Messages

### Factory Errors (custom errors — use `.selector` to match)
| Error | When |
|-------|------|
| `OnlyPlatform()` | Non-platform calls admin function |
| `InvalidTokenAddress()` | Token is address(0) |
| `TokenNotApproved()` | Token not in whitelist |
| `BuyerSellerSame()` | Buyer == seller |
| `FeeTooHigh()` | Fee exceeds maxFeeBps or MAX_FEE_BPS |
| `NoMilestones()` | Empty milestone array |
| `InvalidMilestoneAmount()` | A milestone amount is 0 |
| `InvalidSeller()` | Seller is address(0) |
| `TooManyMilestones()` | More than 50 milestones |
| `AutoApprovalDaysTooLow()` | Below 1 day |
| `AutoApprovalDaysTooHigh()` | Above 90 days |
| `DisputeTimeoutDaysTooLow()` | Below 14 days |
| `DisputeTimeoutDaysTooHigh()` | Above 180 days |

### Escrow Errors (require strings)
| String | When |
|--------|------|
| `"Only buyer"` | Non-buyer calls buyer function |
| `"Only seller"` | Non-seller calls seller function |
| `"Only platform"` | Non-platform calls platform function |
| `"Not party"` | Non buyer/seller calls openDispute or timeout |
| `"Already funded"` | fund() called twice |
| `"Not funded"` | submitMilestone before funding |
| `"Escrow cancelled"` | Action on cancelled escrow |
| `"Already cancelled"` | cancelEscrow called twice |
| `"Invalid milestone"` | Index out of range |
| `"Wrong status"` | Action invalid for current milestone status |
| `"Active milestone exists"` | Cancel with SUBMITTED/DISPUTED milestones |
| `"Auto-approval period not elapsed"` | Too early for auto-approval |
| `"Dispute timeout not elapsed"` | Too early for dispute timeout |
| `"Correction window expired"` | Resubmit after 7 days |
| `"Correction window not expired"` | Platform resolves during 7-day window |
| `"No correction window"` | Resubmit on seller-opened dispute |
| `"Too high"` | sellerAward exceeds remaining after dispute fee |

---

## Known Limitation

**PLATFORM address is immutable** on both contracts. If platform keys are lost:
- Factory: cannot create new escrows or change config
- Existing escrows: cannot resolve disputes (but `claimDisputeTimeout` at 30 days provides a safety net)

**Recommendation:** Use a multisig wallet (e.g., Safe) as the platform address.

---

## File Structure

```
src/
  EscrowFactory.sol      — Factory contract (283 lines)
  StablePayEscrow.sol    — Escrow contract (407 lines)
test/
  StablePayEscrow.t.sol  — All tests (1444 lines, 81 tests)
script/
  DeployStablePayEscrow.s.sol — Deploy script
.env.example             — Environment variables template
foundry.toml             — Foundry config (solc 0.8.28, optimizer, cancun EVM)
```

---

## Generating ABIs

After building, ABIs are in the `out/` directory:

```bash
forge build

# Factory ABI
cat out/EscrowFactory.sol/EscrowFactory.json | jq '.abi'

# Escrow ABI
cat out/StablePayEscrow.sol/StablePayEscrow.json | jq '.abi'
```

Copy these JSON files to your backend/frontend project for use with ethers.js, viem, or web3.js.
