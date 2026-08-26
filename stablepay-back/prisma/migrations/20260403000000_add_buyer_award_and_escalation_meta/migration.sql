-- Remove escalationReason column (no longer used at this point)
ALTER TABLE "Milestone" DROP COLUMN IF EXISTS "escalationReason";

-- buyerAward, disputeEscalatedAt, disputeEscalatedBy are added by
-- 20260401143000_add_dispute_terminal_fields — skip if already present
ALTER TABLE "Milestone" ADD COLUMN IF NOT EXISTS "buyerAward" VARCHAR(78);
ALTER TABLE "Milestone" ADD COLUMN IF NOT EXISTS "disputeEscalatedAt" TIMESTAMP(3);
ALTER TABLE "Milestone" ADD COLUMN IF NOT EXISTS "disputeEscalatedBy" VARCHAR(42);
