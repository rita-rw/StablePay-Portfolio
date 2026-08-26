/*
  Warnings:

  - The primary key for the `Escrow` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `id` on the `Escrow` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(42)`.
  - You are about to alter the column `buyer` on the `Escrow` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(42)`.
  - You are about to alter the column `seller` on the `Escrow` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(42)`.
  - You are about to alter the column `token` on the `Escrow` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(42)`.
  - You are about to alter the column `totalAmount` on the `Escrow` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(78)`.
  - You are about to alter the column `metadataHash` on the `Escrow` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(66)`.
  - You are about to alter the column `txHash` on the `Escrow` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(66)`.
  - You are about to alter the column `fundedTxHash` on the `Escrow` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(66)`.
  - You are about to alter the column `description` on the `Escrow` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(2000)`.
  - You are about to alter the column `title` on the `Escrow` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(200)`.
  - You are about to alter the column `escrowAddress` on the `Milestone` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(42)`.
  - You are about to alter the column `amount` on the `Milestone` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(78)`.
  - You are about to alter the column `deliveryReference` on the `Milestone` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(1000)`.
  - You are about to alter the column `disputeOpenedBy` on the `Milestone` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(42)`.
  - You are about to alter the column `disputeReason` on the `Milestone` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(2000)`.
  - You are about to alter the column `metadataHash` on the `ProjectMetadata` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(66)`.
  - You are about to alter the column `title` on the `ProjectMetadata` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(200)`.
  - You are about to alter the column `description` on the `ProjectMetadata` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(2000)`.

*/
-- DropForeignKey
ALTER TABLE "Milestone" DROP CONSTRAINT "Milestone_escrowAddress_fkey";

-- AlterTable
ALTER TABLE "Escrow" DROP CONSTRAINT "Escrow_pkey",
ALTER COLUMN "id" SET DATA TYPE VARCHAR(42),
ALTER COLUMN "buyer" SET DATA TYPE VARCHAR(42),
ALTER COLUMN "seller" SET DATA TYPE VARCHAR(42),
ALTER COLUMN "token" SET DATA TYPE VARCHAR(42),
ALTER COLUMN "totalAmount" SET DATA TYPE VARCHAR(78),
ALTER COLUMN "metadataHash" SET DATA TYPE VARCHAR(66),
ALTER COLUMN "txHash" SET DATA TYPE VARCHAR(66),
ALTER COLUMN "fundedTxHash" SET DATA TYPE VARCHAR(66),
ALTER COLUMN "description" SET DATA TYPE VARCHAR(2000),
ALTER COLUMN "title" SET DATA TYPE VARCHAR(200),
ADD CONSTRAINT "Escrow_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Milestone" ALTER COLUMN "escrowAddress" SET DATA TYPE VARCHAR(42),
ALTER COLUMN "amount" SET DATA TYPE VARCHAR(78),
ALTER COLUMN "deliveryReference" SET DATA TYPE VARCHAR(1000),
ALTER COLUMN "disputeOpenedBy" SET DATA TYPE VARCHAR(42),
ALTER COLUMN "disputeReason" SET DATA TYPE VARCHAR(2000);

-- AlterTable
ALTER TABLE "ProjectMetadata" ALTER COLUMN "metadataHash" SET DATA TYPE VARCHAR(66),
ALTER COLUMN "title" SET DATA TYPE VARCHAR(200),
ALTER COLUMN "description" SET DATA TYPE VARCHAR(2000);

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_escrowAddress_fkey" FOREIGN KEY ("escrowAddress") REFERENCES "Escrow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
