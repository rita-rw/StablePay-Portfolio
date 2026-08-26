# StablePay Smart Contract Audit

**Project:** StablePay  
**Audit type:** Static review and cross-validated AI-assisted analysis  
**Date:** 2026-03-27  
**Reviewed commit:** `516690c`  
**Branch used for audit work:** `audit/smart-contract-review`  
**Compiler context:** Solidity `0.8.28`, Cancun EVM, optimizer `200`, `via_ir = true`

---

## 1. Executive Summary

StablePay is a milestone-based ERC20 escrow system built around a factory pattern. A single `EscrowFactory` deploys one `StablePayEscrow` contract per project. The escrow lifecycle is straightforward: buyer creates, seller accepts, buyer funds, seller submits milestones, buyer approves or disputes, and funds are released or refunded based on milestone state.

No confirmed critical or high-severity direct loss-of-funds bug was established from the reviewed source.

Two **medium-severity** issues stand out:

1. `sellerEscalate()` resets the dispute timeout anchor used by `claimDisputeTimeout()`, which can delay the timeout safety mechanism.
2. The deployed/default correction-window configuration is effectively **0 days**, making seller resubmission practically unavailable unless the factory default is changed before escrow creation.

The main remaining risks are **trust-model and operational risks**, not pure arithmetic bugs:
- dispute resolution is centralized to a single platform authority
- token safety is delegated to whitelist governance
- there is no pause, rescue, or key-rotation mechanism
- documentation materially misstates current correction-window behavior

### Final severity distribution

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 1 |
| Informational / Trust-model / Operational | 5 |

### Bottom line

- **Demo / testnet / prototype use:** acceptable
- **Production with real user funds:** not recommended until the medium issues and operational assumptions are addressed

---

## 2. Scope

### Production contracts
- `src/EscrowFactory.sol`
- `src/StablePayEscrow.sol`

### Supporting files reviewed
- `test/StablePayEscrow.t.sol`
- `script/DeployStablePayEscrow.s.sol`
- `foundry.toml`
- `CONTRACT_SUMMARY.md`
- `INTEGRATION_GUIDE.md`

### Source of truth rule
The Solidity contracts were treated as authoritative. Documentation was used only as supporting context and checked against code.

---

## 3. Methodology

The merged conclusion is based on:

1. **Manual line-by-line source interpretation** of the two production contracts through the extracted audit evidence.
2. **State-machine review** of milestone transitions:
   - `PENDING`
   - `SUBMITTED`
   - `DISPUTED`
   - `PAID`
   - `REFUNDED`
   - `RESOLVED`
3. **Fund-flow review** across:
   - `fund()`
   - `approveMilestone()`
   - `claimAutoApproval()`
   - `resolveDispute()`
   - `claimDisputeTimeout()`
   - `cancelEscrow()`
4. **Trust-model analysis** of buyer, seller, and platform powers.
5. **Documentation cross-check** against actual code behavior.
6. **Cross-validation** between two independent AI audit passes.

### Limitation
Dynamic execution was not confirmed in the Codex environment because `forge` was not available there. This is still a static audit artifact, not a substitute for full invariant, fuzz, and live test validation.

---

## 4. System Overview

### Architecture

`EscrowFactory` is the entry point. It:
- whitelists approved tokens
- stores platform fee defaults
- stores default timing parameters
- deploys `StablePayEscrow` contracts
- tracks deployed escrows

`StablePayEscrow` is one escrow per project. It:
- stores milestone amounts and status
- holds ERC20 funds
- enforces buyer/seller/platform permissions
- handles approval, dispute, timeout, refund, and payout logic

### Roles

**Buyer**
- creates escrow
- funds escrow
- approves milestones
- can open disputes
- can cancel in allowed states

**Seller**
- accepts or rejects project
- submits milestones
- can claim auto-approval
- can open disputes
- can resubmit in dispute window
- can escalate certain disputes

**Platform**
- resolves disputes
- controls whitelist
- controls future fee/timer defaults

### Lifecycle

1. Buyer creates escrow through factory
2. Seller accepts
3. Buyer funds full amount
4. Seller submits milestone
5. Buyer approves or disputes
6. Funds are released, split, or refunded

### Core trust assumption
This is **not** a trustless escrow protocol. It is a contract-enforced workflow with a centralized dispute resolver and centralized token-governance layer.

---

## 5. Security Findings

### [Medium] `sellerEscalate()` can extend the dispute-timeout clock

**Affected files/functions:**  
`src/StablePayEscrow.sol:sellerEscalate()`  
`src/StablePayEscrow.sol:openDispute()`  
`src/StablePayEscrow.sol:claimDisputeTimeout()`

**Description:**  
Buyer-opened disputes begin a timeout period. The timeout fallback is intended to protect users if the platform fails to resolve the dispute in time. However, `sellerEscalate()` rewrites `disputeOpenedAt`, and `claimDisputeTimeout()` uses that same field as its timeout anchor.

That means escalation can move the timeout clock forward.

**Impact:**  
This does not create direct theft, but it weakens the timeout safety mechanism by allowing additional delay. In practice, this is a **bounded griefing / lock-extension issue**, not a direct fund-loss exploit.

**Why it happens:**  
The same timestamp field is being used for two logically different concepts:
- original dispute opening time
- later escalation timestamp

**Recommendation:**  
Do not overwrite the original timeout anchor when the seller escalates. Keep the original dispute-open time for timeout purposes and track escalation separately if needed.

**Confidence:**  
**Confirmed**

---

### [Medium] Factory default / deploy flow leaves the correction window effectively at 0 days

**Affected files/functions:**  
`src/EscrowFactory.sol` constructor  
`src/EscrowFactory.sol:setDefaultCorrectionWindowDays()`  
`src/EscrowFactory.sol:createEscrow()`  
`src/StablePayEscrow.sol:resubmitDuringDispute()`  
`src/StablePayEscrow.sol:resolveDispute()`  
`script/DeployStablePayEscrow.s.sol`

**Description:**  
The factory default for `defaultCorrectionWindowDays` is `0`, and the deploy flow does not override it. Escrows snapshot this value at creation.

With a 0-day correction window:
- seller resubmission becomes practically unavailable
- buyer-opened disputes become immediately resolvable by the platform

**Impact:**  
This materially changes live system behavior. Any frontend, operator, or user assuming a real seller correction period will be wrong unless the factory default is changed before escrow creation.

**Why it happens:**  
A zero-value constructor default is carried into live escrow configuration, while documentation and assumptions elsewhere describe a nonzero correction window.

**Recommendation:**  
Choose the real production policy explicitly:
- either use an actual correction window and set it before any escrow creation
- or document clearly that correction is disabled by default

Do not allow clients to hard-code a 7-day assumption.

**Confidence:**  
**Confirmed**

---

### [Low] Documentation materially misstates correction-window behavior

**Affected files:**  
`CONTRACT_SUMMARY.md`  
`INTEGRATION_GUIDE.md`

**Description:**  
Documentation describes the correction window as a fixed 7-day constant, while code makes it:
- configurable at the factory level
- snapshotted per escrow
- defaulted to `0`

**Impact:**  
This is not a contract exploit, but it is operationally important. Integrators and users can build incorrect expectations and workflows.

**Why it happens:**  
Docs were not updated to reflect current code and deployment semantics.

**Recommendation:**  
Update all docs to describe:
- configurable factory default
- per-escrow immutable snapshot
- actual deployed default

**Confidence:**  
**Confirmed**

---

## 6. Architecture / Trust Model Risks

These are important, but they are better classified as systemic risks than code vulnerabilities.

### Buyer-favoring timeout policy
`claimDisputeTimeout()` refunds the buyer minus dispute fee regardless of which party opened the dispute.

That is a **confirmed behavior**, but it is best treated as a protocol policy choice, not automatically a bug. It does mean seller recovery during platform inactivity still depends heavily on platform action.

### Platform revenue is not economically neutral in disputes
The platform receives:
- the fixed dispute fee
- plus platform fee applied on seller-awarded portion

That means platform revenue can increase as seller award increases. This is not a math bug, but it creates a **resolver incentive alignment question**.

### ERC20 whitelist is security-critical
The escrow assumes standard token behavior. If a fee-on-transfer, rebasing, blacklistable, paused, or otherwise problematic token is whitelisted, accounting and payout assumptions can fail.

This makes token-governance quality part of the security model.

### No pause / rescue / key rotation
The platform address is immutable and there is no pause or emergency-response mechanism. If a serious issue is found in production, there is limited ability to contain damage at the contract layer.

### Factory provenance must be verified by integrations
`StablePayEscrow` stores `FACTORY`, but on-chain logic does not enforce canonical-factory-only usage beyond external tracking. Integrations should verify factory provenance and/or `isValidEscrow` to avoid trusting spoofed look-alike escrows.

---

## 7. Positive Security Observations

1. **Core accounting appears sound under standard ERC20 assumptions.**  
   No confirmed direct double-pay or overpay bug was established in the standard payout/refund paths.

2. **Reentrancy protection is applied to token-moving paths.**  
   This is good defensive structure.

3. **SafeERC20 is used consistently.**  
   That reduces risk from common token-return-value problems.

4. **Per-escrow configuration is immutable after creation.**  
   Existing escrows are protected from later factory parameter changes.

5. **State machine appears clean.**  
   Terminal states are treated as terminal and transitions are guarded by expected-state checks.

6. **Milestone count is capped.**  
   `MAX_MILESTONES = 50` meaningfully constrains loop exposure.

7. **Seller acceptance gate before funding is sensible.**  
   Buyers cannot fund a project the seller never accepted.

---

## 8. Test and Assurance Gaps

The test suite is substantial, but there are still important coverage gaps.

### Missing or weakly evidenced areas
- no clear invariant/property-style accounting verification
- no explicit timeout-monotonicity test for the escalation issue
- no explicit adverse-token tests
- no explicit coverage of default correction-window semantics in deployed configuration
- no strong live-style test evidence around 6-decimal production token behavior

### Why this matters
This codebase is past the stage where only example-based happy-path testing is enough. The next level should include:
- invariant tests
- fuzz tests
- realistic USDC-style decimal tests
- exact tests for dispute timer behavior

---

## 9. Open Questions

1. Is `defaultCorrectionWindowDays = 0` actually intended production policy, or is it leftover test-oriented configuration?
2. Is buyer-favoring timeout behavior intentional even when seller opened the dispute?
3. Is the platform address definitely going to be a multisig in production?
4. Is the platform incentive to earn more when seller award increases acceptable?
5. Will all integrations verify canonical factory provenance before trusting an escrow?
6. What is the incident-response plan if a vulnerability or token issue is discovered after deployment?

---

## 10. Final Verdict

### Suitable now for
- demos
- internal testing
- testnet usage
- portfolio / prototype presentation

### Not yet suitable for
- production handling of meaningful real user funds

### Must address before production
1. Fix the dispute-timeout anchor issue in `sellerEscalate()`
2. Decide and enforce the real correction-window production policy
3. Align docs, deployment, and frontend expectations with actual correction-window behavior
4. Define operational controls around platform authority and multisig usage

### Strongly recommended before production
5. Add invariant and fuzz testing
6. Add realistic 6-decimal token tests
7. Document buyer-favoring timeout behavior clearly
8. Define integration requirements for factory provenance checks

### Lower priority
- dust rounding notes
- unused / lightly useful `FACTORY` provenance field
- deploy script ergonomics
- revert-style consistency

---

## 11. Appendix

### Notable defaults and constants

| Item | Value |
|---|---:|
| `MAX_FEE_BPS` | 1000 |
| default platform fee | 250 bps |
| `DISPUTE_FEE_BPS` | 100 bps |
| `MAX_MILESTONES` | 50 |
| default auto approval | 14 days |
| default dispute timeout | 30 days |
| default correction window | 0 days |