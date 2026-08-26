import { parseAbiItem } from "viem";

export const escrowCreatedEvent = parseAbiItem(
  "event EscrowCreated(address indexed escrow, address indexed buyer, address indexed seller, address token, uint256 totalAmount, uint256 milestoneCount, bytes32 metadataHash)"
);

export const fundedEvent = parseAbiItem(
  "event Funded(address indexed buyer, uint256 amount)"
);

export const milestoneSubmittedEvent = parseAbiItem(
  "event MilestoneSubmitted(uint256 indexed milestoneIndex, bytes32 deliveryHash)"
);

export const milestoneApprovedEvent = parseAbiItem(
  "event MilestoneApproved(uint256 indexed milestoneIndex)"
);

export const milestoneAutoApprovedEvent = parseAbiItem(
  "event MilestoneAutoApproved(uint256 indexed milestoneIndex)"
);

export const escrowCancelledEvent = parseAbiItem(
  "event EscrowCancelled(address indexed buyer)"
);

export const milestoneRefundedEvent = parseAbiItem(
  "event MilestoneRefunded(uint256 indexed milestoneIndex, uint256 amount)"
);

export const disputeOpenedEvent = parseAbiItem(
  "event DisputeOpened(uint256 indexed milestoneIndex, address indexed openedBy, bytes32 reason)"
);

export const milestoneResubmittedEvent = parseAbiItem(
  "event MilestoneResubmitted(uint256 indexed milestoneIndex, bytes32 deliveryHash)"
);

export const disputeResolvedEvent = parseAbiItem(
  "event DisputeResolved(uint256 indexed milestoneIndex, uint256 sellerAward, uint256 buyerAward, uint256 platformFee, uint256 disputeFee)"
);

export const disputeTimeoutClaimedEvent = parseAbiItem(
  "event DisputeTimeoutClaimed(uint256 indexed milestoneIndex, uint256 buyerRefund, uint256 disputeFee)"
);

export const projectAcceptedEvent = parseAbiItem(
  "event ProjectAccepted(address indexed seller)"
);

export const projectRejectedEvent = parseAbiItem(
  "event ProjectRejected(address indexed seller)"
);

export const disputeEscalatedEvent = parseAbiItem(
  "event DisputeEscalated(uint256 indexed milestoneIndex, bytes32 reason)"
);
