export interface Milestone {
  escrowAddress?: string;
  milestoneIndex: number;
  label?: string | null;
  status: string;
  amount?: string;
  deliveryReference?: string | null;
  paidAt?: string | null;
  disputeOpenedAt?: string | null;
  disputeOpenedBy?: string | null;
  disputeReason?: string | null;
  sellerAward?: string | null;
  buyerAward?: string | null;
  isEscalated?: boolean;
}

export interface Escrow {
  id: string;
  buyer: string;
  seller: string;
  token?: string;
  totalAmount: string;
  milestoneCount: number;
  txHash?: string | null;
  fundedTxHash?: string | null;
  title?: string | null;
  description?: string | null;
  status: string;
  createdAt: string;
  cancelledAt?: string | null;
  milestones?: Milestone[];
  buyerCompany?: string | null;
  sellerCompany?: string | null;
  correctionWindowDays?: number | null;
  autoApprovalDays?: number | null;
  disputeTimeoutDays?: number | null;
}

export interface MilestoneInput {
  label: string;
  amount: string;
}
