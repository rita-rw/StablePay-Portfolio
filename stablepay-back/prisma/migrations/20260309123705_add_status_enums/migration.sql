/*
  Warnings:

  - The `status` column on the `Escrow` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `Milestone` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "EscrowStatus" AS ENUM ('CREATED', 'FUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PENDING', 'SUBMITTED', 'DISPUTED', 'PAID', 'REFUNDED', 'RESOLVED');

-- AlterTable
ALTER TABLE "Escrow" DROP COLUMN "status",
ADD COLUMN     "status" "EscrowStatus" NOT NULL DEFAULT 'CREATED';

-- AlterTable
ALTER TABLE "Milestone" DROP COLUMN "status",
ADD COLUMN     "status" "MilestoneStatus" NOT NULL DEFAULT 'PENDING';
