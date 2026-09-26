-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN "label" VARCHAR(100);

-- AlterTable
ALTER TABLE "ProjectMetadata" ADD COLUMN "milestoneLabels" TEXT;
