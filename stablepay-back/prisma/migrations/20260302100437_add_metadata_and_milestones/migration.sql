-- AlterTable
ALTER TABLE "Escrow" ADD COLUMN     "description" TEXT,
ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "escrowAddress" TEXT NOT NULL,
    "milestoneIndex" INTEGER NOT NULL,
    "amount" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "deliveryReference" TEXT,
    "submittedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMetadata" (
    "id" TEXT NOT NULL,
    "metadataHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "ProjectMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Milestone_escrowAddress_idx" ON "Milestone"("escrowAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_escrowAddress_milestoneIndex_key" ON "Milestone"("escrowAddress", "milestoneIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMetadata_metadataHash_key" ON "ProjectMetadata"("metadataHash");

-- CreateIndex
CREATE INDEX "Escrow_metadataHash_idx" ON "Escrow"("metadataHash");

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_escrowAddress_fkey" FOREIGN KEY ("escrowAddress") REFERENCES "Escrow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
