-- AlterTable
ALTER TABLE "Escrow" ADD COLUMN     "fundedAt" TIMESTAMP(3),
ADD COLUMN     "fundedTxHash" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'CREATED';
