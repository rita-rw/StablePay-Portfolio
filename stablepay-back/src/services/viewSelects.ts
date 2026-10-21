import { Prisma } from "../../generated/prisma/client";

export const publicUserProfileSelect = {
  address: true,
  companyName: true,
} satisfies Prisma.UserSelect;

export const privateUserProfileSelect = {
  address: true,
  companyName: true,
  orgNumber: true,
  email: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export const publicMilestoneSelect = {
  escrowAddress: true,
  milestoneIndex: true,
  amount: true,
  label: true,
  status: true,
  deliveryReference: true,
  // Already readable on-chain. Included here so the delivery card and the
  // auto-release line can render in the same paint, before the wallet signature.
  submittedAt: true,
} satisfies Prisma.MilestoneSelect;

export const participantMilestoneSelect = {
  escrowAddress: true,
  milestoneIndex: true,
  amount: true,
  label: true,
  status: true,
  deliveryReference: true,
  submittedAt: true,
  paidAt: true,
  autoApproved: true,
  disputeReason: true,
  disputeOpenedAt: true,
  disputeOpenedBy: true,
  isEscalated: true,
  sellerAward: true,
  buyerAward: true,
  disputeEscalatedAt: true,
  disputeEscalatedBy: true,
  sellerResponse: true,
} satisfies Prisma.MilestoneSelect;

export const escrowDetailFields = {
  id: true,
  buyer: true,
  seller: true,
  token: true,
  totalAmount: true,
  milestoneCount: true,
  metadataHash: true,
  title: true,
  description: true,
  txHash: true,
  status: true,
  fundedTxHash: true,
  fundedAt: true,
  sellerAcceptedAt: true,
  cancelledAt: true,
  createdAt: true,
  correctionWindowDays: true,
  autoApprovalDays: true,
  disputeTimeoutDays: true,
} as const;

export const publicEscrowDetailSelect = {
  ...escrowDetailFields,
  milestones: {
    orderBy: { milestoneIndex: "asc" },
    select: publicMilestoneSelect,
  },
} satisfies Prisma.EscrowSelect;

export const participantEscrowDetailSelect = {
  ...escrowDetailFields,
  milestones: {
    orderBy: { milestoneIndex: "asc" },
    select: participantMilestoneSelect,
  },
} satisfies Prisma.EscrowSelect;
