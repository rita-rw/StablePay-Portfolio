// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/**
 * @title StablePayEscrow
 * @notice Escrow contract for a single project with milestone-based payments.
 *         Buyer deposits funds, seller delivers work milestone by milestone,
 *         and funds are released when each milestone is approved.
 * @dev One instance per project — created by EscrowFactory, never directly.
 */
contract StablePayEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Enums ============
    // An enum is a fixed list of named states. A milestone can only be in one state at a time.

    enum MilestoneStatus {
        PENDING, // Waiting for seller to submit work
        SUBMITTED, // Seller submitted — waiting for buyer to approve or dispute
        DISPUTED, // Dispute opened — waiting for platform to resolve
        PAID, // Funds released to seller (approved or auto-approved)
        REFUNDED, // Funds returned to buyer
        RESOLVED // Dispute resolved — funds were split between both parties
    }

    // ============ Structs ============
    // A struct groups related data together into one unit.

    // Note: this struct intentionally does NOT have buyerApproved/sellerApproved fields.
    // They were removed because they were written to but never read by any logic,
    // wasting ~5,000 gas per write with zero benefit.
    struct Milestone {
        uint256 amount; // This milestone's share of the total — e.g. 300 USDC out of 1000 USDC total
        MilestoneStatus status; // Current state of this milestone
        bytes32 deliveryHash; // Hash of the seller's delivery (proof of work)
        uint256 submittedAt; // Timestamp when seller submitted (used for auto-approval timer)
        // Dispute fields — only used when status == DISPUTED
        bytes32 disputeReason; // Why the dispute was opened
        uint256 disputeOpenedAt; // Timestamp when dispute was opened (used for timeout timer)
        address disputeOpenedBy; // Who opened the dispute — buyer or seller
    }

    // ============ Immutable State ============
    // Set once in the constructor, locked forever after that.
    // These never change for the lifetime of this escrow.

    address public immutable FACTORY; // The factory that deployed this escrow
    address public immutable BUYER; // Who pays (locks funds)
    address public immutable SELLER; // Who delivers work and receives payment
    address public immutable PLATFORM; // Dispute resolver and fee receiver
    address public immutable TOKEN; // ERC20 token used for payment (e.g. USDC)
    uint256 public immutable FEE_BPS; // Platform fee in basis points (250 = 2.5%)
    bytes32 public immutable METADATA_HASH; // Hash of off-chain project details
    uint256 public immutable AUTO_APPROVAL_DAYS; // Days before seller can auto-claim submitted milestone
    uint256 public immutable DISPUTE_TIMEOUT_DAYS; // Days before either party can claim dispute timeout
    uint256 public immutable CORRECTION_WINDOW_DAYS; // Days seller has to resubmit after a buyer-opened dispute

    // ============ Constants ============
    // Fixed values hardcoded into the contract — cannot be changed by anyone, ever.
    // These protect users from the platform changing critical rules after deployment.

    /// @notice Extra fee taken only when the platform resolves a dispute (1% = 100 bps)
    /// @dev This is on top of the normal platform fee, and only applies when platform intervenes.
    ///      Not charged on claimDisputeTimeout — the platform did not intervene there.
    uint256 public constant DISPUTE_FEE_BPS = 100;

    // ============ Mutable State ============
    // These values can change during the lifetime of the escrow.

    /// @notice Whether the seller has accepted this project — required before buyer can fund
    bool public sellerAccepted;

    /// @notice Whether the buyer has deposited funds into this escrow
    bool public funded;

    /// @notice Whether this escrow has been permanently closed by the buyer.
    ///         Once true, no new funds can be deposited and no new work can be submitted.
    ///         This prevents funds from being locked forever if a project never starts,
    ///         and allows the buyer to reclaim funds from unstarted milestones.
    bool public cancelled;

    /// @notice Total amount locked in this escrow (sum of all milestone amounts)
    uint256 public totalAmount;

    /// @notice All milestones for this project
    Milestone[] public milestones;

    // ============ Events ============
    // Emitted when something important happens — used by frontend/backend to track state.

    /// @notice Emitted when the seller accepts the project
    event ProjectAccepted(address indexed seller);

    /// @notice Emitted when the seller rejects the project
    event ProjectRejected(address indexed seller);

    /// @notice Emitted when the buyer deposits funds
    event Funded(address indexed buyer, uint256 amount);

    /// @notice Emitted when the seller submits work for a milestone
    event MilestoneSubmitted(uint256 indexed milestoneIndex, bytes32 deliveryHash);

    /// @notice Emitted when the buyer approves a milestone and funds are released
    event MilestoneApproved(uint256 indexed milestoneIndex);

    /// @notice Emitted when a dispute is opened on a milestone
    event DisputeOpened(uint256 indexed milestoneIndex, address indexed openedBy, bytes32 reason);

    /// @notice Emitted when the platform resolves a dispute
    event DisputeResolved(
        uint256 indexed milestoneIndex, uint256 sellerAward, uint256 buyerAward, uint256 platformFee, uint256 disputeFee
    );

    /// @notice Emitted when the buyer cancels the escrow
    event EscrowCancelled(address indexed buyer);

    /// @notice Emitted once per milestone that is refunded when the escrow is cancelled
    event MilestoneRefunded(uint256 indexed milestoneIndex, uint256 amount);

    /// @notice Emitted when the seller auto-claims a milestone after the approval deadline
    event MilestoneAutoApproved(uint256 indexed milestoneIndex);

    /// @notice Emitted when either party claims a dispute timeout (platform did not act in time)
    /// @dev disputeFee is always 0 — kept so the event signature stays the same for indexers
    event DisputeTimeoutClaimed(uint256 indexed milestoneIndex, uint256 buyerRefund, uint256 disputeFee);

    /// @notice Emitted when the seller resubmits corrected work during a buyer-opened dispute
    event MilestoneResubmitted(uint256 indexed milestoneIndex, bytes32 deliveryHash);

    /// @notice Emitted when the seller escalates a buyer-opened dispute directly to admin
    event DisputeEscalated(uint256 indexed milestoneIndex, bytes32 reason);

    // ============ Constructor ============
    // Called once by EscrowFactory when a new escrow is created.
    // All immutable values are set here and can never be changed.

    /**
     * @notice Sets up a new escrow with all parties, token, fee, and milestones
     * @param _buyer              Address of the buyer (payer)
     * @param _seller             Address of the seller (service provider)
     * @param _platform           Address of the platform (dispute resolver, fee receiver)
     * @param _token              Address of the payment token (e.g. USDC)
     * @param _feeBps             Platform fee in basis points (250 = 2.5%)
     * @param _milestoneAmounts   Array of amounts for each milestone
     * @param _metadataHash       Hash of off-chain project details
     * @param _autoApprovalDays      Days before seller can auto-claim a submitted milestone
     * @param _disputeTimeoutDays    Days before either party can trigger a dispute timeout
     * @param _correctionWindowDays  Days seller has to resubmit after a buyer-opened dispute
     */
    constructor(
        address _buyer,
        address _seller,
        address _platform,
        address _token,
        uint256 _feeBps,
        uint256[] memory _milestoneAmounts,
        bytes32 _metadataHash,
        uint256 _autoApprovalDays,
        uint256 _disputeTimeoutDays,
        uint256 _correctionWindowDays
    ) {
        FACTORY = msg.sender; // The factory is whoever deployed this contract
        BUYER = _buyer;
        SELLER = _seller;
        PLATFORM = _platform;
        TOKEN = _token;
        FEE_BPS = _feeBps;
        METADATA_HASH = _metadataHash;
        AUTO_APPROVAL_DAYS = _autoApprovalDays;
        DISPUTE_TIMEOUT_DAYS = _disputeTimeoutDays;
        CORRECTION_WINDOW_DAYS = _correctionWindowDays;

        // Create all milestones with PENDING status and calculate the total amount
        uint256 total = 0;
        for (uint256 i = 0; i < _milestoneAmounts.length; i++) {
            milestones.push(
                Milestone({
                    amount: _milestoneAmounts[i],
                    status: MilestoneStatus.PENDING,
                    deliveryHash: bytes32(0),
                    submittedAt: 0,
                    disputeReason: bytes32(0),
                    disputeOpenedAt: 0,
                    disputeOpenedBy: address(0)
                })
            );
            total += _milestoneAmounts[i];
        }
        totalAmount = total;
    }

    // ============ Modifiers ============
    // Reusable access control guards — placed before a function to restrict who can call it.

    modifier onlyBuyer() {
        require(msg.sender == BUYER, "Only buyer");
        _;
    }

    modifier onlySeller() {
        require(msg.sender == SELLER, "Only seller");
        _;
    }

    modifier onlyPlatform() {
        require(msg.sender == PLATFORM, "Only platform");
        _;
    }

    // ============ View Functions ============
    // Read-only — costs zero gas when called from frontend/backend.

    /// @notice Returns the total number of milestones in this escrow
    function milestoneCount() external view returns (uint256) {
        return milestones.length;
    }

    // ============ Core Functions ============
    // The main escrow flow: fund → submit → approve (or dispute → resolve)

    /// @notice Seller accepts the project — required before the buyer can fund
    function acceptProject() external onlySeller {
        require(!cancelled, "Escrow cancelled");
        require(!sellerAccepted, "Already accepted");
        sellerAccepted = true;
        emit ProjectAccepted(SELLER);
    }

    /// @notice Seller rejects the project — cancels the escrow before any funds are locked
    function rejectProject() external onlySeller {
        require(!cancelled, "Escrow cancelled");
        require(!sellerAccepted, "Already accepted");
        cancelled = true;
        emit ProjectRejected(SELLER);
    }

    /// @notice Buyer deposits the full amount (sum of all milestones) into the escrow
    /// @dev Important: this contract assumes exactly `totalAmount` arrives.
    ///      Fee-on-transfer tokens (e.g. some versions of USDT) charge a fee during transfer
    ///      and deliver less than expected — this breaks the accounting and causes later
    ///      payouts to revert. Never approve such tokens in the factory whitelist.
    function fund() external onlyBuyer nonReentrant {
        require(!cancelled, "Escrow cancelled");
        require(sellerAccepted, "Seller has not accepted");
        require(!funded, "Already funded");
        funded = true;
        IERC20(TOKEN).safeTransferFrom(BUYER, address(this), totalAmount);
        emit Funded(BUYER, totalAmount);
    }

    /// @notice Seller submits proof of delivery for a milestone
    function submitMilestone(uint256 milestoneIndex, bytes32 deliveryHash) external onlySeller nonReentrant {
        // Prevent submitting work after the buyer has cancelled
        require(!cancelled, "Escrow cancelled");
        require(funded, "Not funded");
        require(milestoneIndex < milestones.length, "Invalid milestone");

        Milestone storage m = milestones[milestoneIndex];
        require(m.status == MilestoneStatus.PENDING, "Wrong status");

        m.status = MilestoneStatus.SUBMITTED;
        m.deliveryHash = deliveryHash;
        m.submittedAt = block.timestamp;

        emit MilestoneSubmitted(milestoneIndex, deliveryHash);
    }

    /// @notice Buyer approves a submitted milestone and releases funds to the seller
    /// @dev Normal happy path — no dispute fee is charged here
    function approveMilestone(uint256 milestoneIndex) external onlyBuyer nonReentrant {
        require(milestoneIndex < milestones.length, "Invalid milestone");
        Milestone storage m = milestones[milestoneIndex];
        require(m.status == MilestoneStatus.SUBMITTED, "Wrong status");

        m.status = MilestoneStatus.PAID;

        uint256 platformFee = _calculateFee(m.amount, FEE_BPS);
        uint256 sellerNet = m.amount - platformFee;

        if (platformFee > 0) IERC20(TOKEN).safeTransfer(PLATFORM, platformFee);
        IERC20(TOKEN).safeTransfer(SELLER, sellerNet);

        emit MilestoneApproved(milestoneIndex);
    }

    /// @notice Seller claims funds after the auto-approval deadline has passed without buyer action
    function claimAutoApproval(uint256 milestoneIndex) external onlySeller nonReentrant {
        require(milestoneIndex < milestones.length, "Invalid milestone");
        Milestone storage m = milestones[milestoneIndex];
        require(m.status == MilestoneStatus.SUBMITTED, "Wrong status");
        require(block.timestamp >= m.submittedAt + (AUTO_APPROVAL_DAYS * 1 days), "Auto-approval period not elapsed");

        m.status = MilestoneStatus.PAID;

        uint256 platformFee = _calculateFee(m.amount, FEE_BPS);
        uint256 sellerNet = m.amount - platformFee;

        if (platformFee > 0) IERC20(TOKEN).safeTransfer(PLATFORM, platformFee);
        IERC20(TOKEN).safeTransfer(SELLER, sellerNet);

        emit MilestoneAutoApproved(milestoneIndex);
    }

    /// @notice Buyer or seller opens a dispute on a submitted milestone
    function openDispute(uint256 milestoneIndex, bytes32 reason) external nonReentrant {
        require(msg.sender == BUYER || msg.sender == SELLER, "Not party");
        require(milestoneIndex < milestones.length, "Invalid milestone");

        Milestone storage m = milestones[milestoneIndex];
        require(m.status == MilestoneStatus.SUBMITTED, "Wrong status");
        // After the auto-approval deadline the funds belong to the seller — buyer can no longer dispute.
        // Uses < so it never overlaps with claimAutoApproval's >=
        if (msg.sender == BUYER) {
            require(block.timestamp < m.submittedAt + (AUTO_APPROVAL_DAYS * 1 days), "Auto-approval period elapsed");
        }

        m.status = MilestoneStatus.DISPUTED;
        m.disputeReason = reason;
        m.disputeOpenedAt = block.timestamp;
        m.disputeOpenedBy = msg.sender;

        emit DisputeOpened(milestoneIndex, msg.sender, reason);
    }

    /// @notice Seller submits corrected work during a buyer-opened dispute (7-day correction window)
    /// @dev Only available when the buyer opened the dispute — gives seller a chance to fix the issue
    ///      before the platform needs to step in. Resets the milestone back to SUBMITTED.
    function resubmitDuringDispute(uint256 milestoneIndex, bytes32 deliveryHash) external onlySeller nonReentrant {
        require(milestoneIndex < milestones.length, "Invalid milestone");

        Milestone storage m = milestones[milestoneIndex];
        require(m.status == MilestoneStatus.DISPUTED, "Wrong status");
        require(m.disputeOpenedBy == BUYER, "No correction window");
        // Uses < so it never overlaps with resolveDispute's >=
        require(block.timestamp < m.disputeOpenedAt + (CORRECTION_WINDOW_DAYS * 1 days), "Correction window expired");

        // Reset the milestone back to SUBMITTED with the new delivery
        m.status = MilestoneStatus.SUBMITTED;
        m.deliveryHash = deliveryHash;
        m.submittedAt = block.timestamp;
        m.disputeReason = bytes32(0);
        m.disputeOpenedAt = 0;
        m.disputeOpenedBy = address(0);

        emit MilestoneResubmitted(milestoneIndex, deliveryHash);
    }

    /// @notice Seller escalates a buyer-opened dispute directly to admin — skips the correction window
    /// @dev Use this when the seller believes their work is correct and does not want to resubmit.
    ///      Sets disputeOpenedBy to SELLER so admin can resolve immediately without waiting.
    /// @param milestoneIndex The milestone to escalate
    /// @param reason         Seller's reason for escalating
    function sellerEscalate(uint256 milestoneIndex, bytes32 reason) external onlySeller nonReentrant {
        require(milestoneIndex < milestones.length, "Invalid milestone");

        Milestone storage m = milestones[milestoneIndex];
        require(m.status == MilestoneStatus.DISPUTED, "Wrong status");
        require(m.disputeOpenedBy == BUYER, "Only when buyer disputed");

        // Transfer ownership of the dispute to the seller — admin can now resolve immediately
        m.disputeOpenedBy = SELLER;
        m.disputeReason = reason;
        // disputeOpenedAt is NOT reset — the buyer's dispute timeout keeps counting from the original dispute

        emit DisputeEscalated(milestoneIndex, reason);
    }

    /**
     * @notice Buyer cancels the escrow and reclaims funds from unstarted milestones
     * @dev Case 1 (not funded): just marks as cancelled — no funds to return.
     *      Case 2 (funded): refunds all PENDING milestones to the buyer.
     *      Reverts if any milestone is SUBMITTED or DISPUTED — active work must be resolved first.
     */
    function cancelEscrow() external onlyBuyer nonReentrant {
        require(!cancelled, "Already cancelled");

        if (!funded) {
            // No funds deposited yet — just close the escrow to prevent future use
            cancelled = true;
            emit EscrowCancelled(BUYER);
            return;
        }

        // Funded: buyer can only reclaim milestones that have not been started (PENDING).
        // If any milestone is SUBMITTED or DISPUTED, that means active work is in progress
        // and must be approved or resolved before the escrow can be cancelled.
        uint256 totalRefund = 0;
        for (uint256 i = 0; i < milestones.length; i++) {
            Milestone storage m = milestones[i];

            if (m.status == MilestoneStatus.SUBMITTED || m.status == MilestoneStatus.DISPUTED) {
                // Active work in progress — must be approved or resolved before cancelling
                revert("Active milestone exists");
            }

            if (m.status == MilestoneStatus.PENDING) {
                // Refund this untouched milestone back to the buyer
                totalRefund += m.amount;
                m.status = MilestoneStatus.REFUNDED;
                emit MilestoneRefunded(i, m.amount);
            }
            // PAID and REFUNDED milestones are already settled — skip them
        }

        cancelled = true;

        if (totalRefund > 0) {
            // Single transfer for all pending milestones (more gas-efficient than one per milestone)
            IERC20(TOKEN).safeTransfer(BUYER, totalRefund);
        }

        emit EscrowCancelled(BUYER);
    }

    /**
     * @notice Platform resolves a dispute by deciding how much the seller receives
     * @dev sellerAward = how much goes to the seller (platform decides this).
     *      Whatever is left (after dispute fee) goes to the buyer.
     *      The dispute fee (1%) is always taken from the total pot — it's the cost of arbitration.
     *      The normal platform fee (FEE_BPS) is only charged on the seller's portion.
     *      If sellerAward is 0 (buyer wins entirely), only the dispute fee is taken — no platform fee.
     *
     *      If the buyer opened the dispute, the platform must wait for the 7-day correction window
     *      to expire before resolving — this gives the seller a chance to fix the issue first.
     */
    function resolveDispute(uint256 milestoneIndex, uint256 sellerAward) external onlyPlatform nonReentrant {
        require(milestoneIndex < milestones.length, "Invalid milestone");

        Milestone storage m = milestones[milestoneIndex];
        require(m.status == MilestoneStatus.DISPUTED, "Wrong status");

        // If buyer opened the dispute, seller had 7 days to resubmit — wait for that window first
        if (m.disputeOpenedBy == BUYER) {
            require(
                block.timestamp >= m.disputeOpenedAt + (CORRECTION_WINDOW_DAYS * 1 days),
                "Correction window not expired"
            );
        }

        uint256 amount = m.amount;

        // Step 1: Take the dispute fee from the total pot first
        uint256 disputeFee = _calculateFee(amount, DISPUTE_FEE_BPS);
        uint256 remaining = amount - disputeFee;

        // Step 2: sellerAward cannot exceed what's left after the dispute fee
        require(sellerAward <= remaining, "Too high");

        // Step 3: buyer gets whatever the seller doesn't
        uint256 buyerAward = remaining - sellerAward;

        // Step 4: Set the correct final status
        // REFUNDED = buyer got everything, PAID = seller got everything, RESOLVED = split
        if (sellerAward == 0) {
            m.status = MilestoneStatus.REFUNDED;
        } else if (buyerAward == 0) {
            m.status = MilestoneStatus.PAID;
        } else {
            m.status = MilestoneStatus.RESOLVED;
        }

        // Step 5: Pay the buyer (if they get anything)
        if (buyerAward > 0) {
            IERC20(TOKEN).safeTransfer(BUYER, buyerAward);
        }

        // Step 6: Pay the seller and platform (if seller gets anything)
        uint256 platformFee = 0;
        if (sellerAward > 0) {
            platformFee = _calculateFee(sellerAward, FEE_BPS);
            uint256 sellerNet = sellerAward - platformFee;

            IERC20(TOKEN).safeTransfer(PLATFORM, platformFee + disputeFee);
            IERC20(TOKEN).safeTransfer(SELLER, sellerNet);
        } else {
            // Seller gets nothing — platform still collects the dispute fee
            IERC20(TOKEN).safeTransfer(PLATFORM, disputeFee);
        }

        emit DisputeResolved(milestoneIndex, sellerAward, buyerAward, platformFee, disputeFee);
    }

    /// @notice Either party can trigger this if the platform has not resolved a dispute in time
    /// @dev Safety net against an inactive or malicious platform holding funds hostage.
    ///      Buyer always gets the full refund — if no one resolves the dispute, seller loses by default.
    ///      No dispute fee: the platform did not resolve the dispute, so it earns nothing.
    /// @param milestoneIndex Index of the disputed milestone
    function claimDisputeTimeout(uint256 milestoneIndex) external nonReentrant {
        require(msg.sender == BUYER || msg.sender == SELLER, "Not party");
        require(milestoneIndex < milestones.length, "Invalid milestone");

        Milestone storage m = milestones[milestoneIndex];
        require(m.status == MilestoneStatus.DISPUTED, "Wrong status");
        require(block.timestamp >= m.disputeOpenedAt + (DISPUTE_TIMEOUT_DAYS * 1 days), "Dispute timeout not elapsed");

        m.status = MilestoneStatus.REFUNDED;

        IERC20(TOKEN).safeTransfer(BUYER, m.amount);

        emit DisputeTimeoutClaimed(milestoneIndex, m.amount, 0);
    }

    // ============ Internal Helpers ============
    // Private utility functions used internally — not callable from outside.

    /// @dev Calculates a fee amount from a total: (amount * feeBps) / 10,000
    ///      Example: amount = 1000 USDC, feeBps = 250 → fee = 25 USDC (2.5%)
    function _calculateFee(uint256 amount, uint256 feeBps) internal pure returns (uint256) {
        return (amount * feeBps) / 10_000;
    }
}
