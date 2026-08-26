-- AlterTable
ALTER TABLE "Escrow" ADD COLUMN "correctionWindowDays" INTEGER,
ADD COLUMN "autoApprovalDays" INTEGER,
ADD COLUMN "disputeTimeoutDays" INTEGER;
