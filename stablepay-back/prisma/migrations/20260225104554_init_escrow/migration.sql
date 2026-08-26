-- CreateTable
CREATE TABLE "Escrow" (
    "id" TEXT NOT NULL,
    "buyer" TEXT NOT NULL,
    "seller" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "totalAmount" TEXT NOT NULL,
    "milestoneCount" INTEGER NOT NULL,
    "metadataHash" TEXT,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Escrow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Escrow_buyer_idx" ON "Escrow"("buyer");

-- CreateIndex
CREATE INDEX "Escrow_seller_idx" ON "Escrow"("seller");
