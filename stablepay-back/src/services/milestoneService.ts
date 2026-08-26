import { prisma } from "../prisma";
import { participantMilestoneSelect, publicMilestoneSelect } from "./viewSelects";

export async function findMilestone(escrowAddress: string, milestoneIndex: number) {
  return prisma.milestone.findUnique({
    where: { escrowAddress_milestoneIndex: { escrowAddress, milestoneIndex } },
  });
}

export async function getMilestonesByEscrow(escrowAddress: string) {
  return prisma.milestone.findMany({
    where: { escrowAddress },
    orderBy: { milestoneIndex: "asc" },
  });
}

export async function getPublicMilestonesByEscrow(escrowAddress: string) {
  return prisma.milestone.findMany({
    where: { escrowAddress: { equals: escrowAddress, mode: "insensitive" } },
    select: publicMilestoneSelect,
    orderBy: { milestoneIndex: "asc" },
  });
}

export async function getParticipantMilestonesByEscrow(escrowAddress: string) {
  return prisma.milestone.findMany({
    where: { escrowAddress: { equals: escrowAddress, mode: "insensitive" } },
    select: participantMilestoneSelect,
    orderBy: { milestoneIndex: "asc" },
  });
}

export async function updateMilestoneDelivery(
  escrowAddress: string,
  milestoneIndex: number,
  deliveryReference: string
) {
  return prisma.milestone.update({
    where: { escrowAddress_milestoneIndex: { escrowAddress, milestoneIndex } },
    data: { deliveryReference },
  });
}

export async function updateMilestoneDisputeReason(
  escrowAddress: string,
  milestoneIndex: number,
  disputeReason: string
) {
  return prisma.milestone.update({
    where: { escrowAddress_milestoneIndex: { escrowAddress, milestoneIndex } },
    data: { disputeReason },
  });
}

export async function findDisputedMilestones() {
  return prisma.milestone.findMany({
    where: { disputeOpenedAt: { not: null } },
    include: { escrow: true },
    orderBy: { disputeOpenedAt: "asc" },
  });
}
