-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN     "disputeOpenedAt" TIMESTAMP(3),
ADD COLUMN     "disputeOpenedBy" TEXT,
ADD COLUMN     "disputeReason" TEXT;
