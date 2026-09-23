import { prisma } from "../prisma";
import {
  participantEscrowDetailSelect,
  publicEscrowDetailSelect,
  escrowDetailFields,
  publicMilestoneSelect,
  participantMilestoneSelect,
} from "./viewSelects";

export async function findEscrowById(escrowAddress: string) {
  return prisma.escrow.findFirst({
    where: { id: { equals: escrowAddress, mode: "insensitive" } },
    include: { milestones: { orderBy: { milestoneIndex: "asc" } } },
  });
}

export async function findEscrowPartiesById(escrowAddress: string) {
  return prisma.escrow.findFirst({
    where: { id: { equals: escrowAddress, mode: "insensitive" } },
    select: { id: true, buyer: true, seller: true },
  });
}

export async function findPublicEscrowById(escrowAddress: string) {
  return prisma.escrow.findFirst({
    where: { id: { equals: escrowAddress, mode: "insensitive" } },
    select: publicEscrowDetailSelect,
  });
}

export async function findParticipantEscrowById(escrowAddress: string) {
  return prisma.escrow.findFirst({
    where: { id: { equals: escrowAddress, mode: "insensitive" } },
    select: participantEscrowDetailSelect,
  });
}

export async function hasSharedEscrow(addressA: string, addressB: string): Promise<boolean> {
  const count = await prisma.escrow.count({
    where: {
      OR: [
        { buyer: { equals: addressA, mode: "insensitive" }, seller: { equals: addressB, mode: "insensitive" } },
        { buyer: { equals: addressB, mode: "insensitive" }, seller: { equals: addressA, mode: "insensitive" } },
      ],
    },
  });
  return count > 0;
}

export async function findEscrowByMetadataHash(metadataHash: string) {
  return prisma.escrow.findFirst({ where: { metadataHash } });
}

export async function findEscrowsForAddress(address: string) {
  return prisma.escrow.findMany({
    where: {
      OR: [
        { buyer: { equals: address, mode: "insensitive" } },
        { seller: { equals: address, mode: "insensitive" } },
      ],
    },
    include: { milestones: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function findPublicEscrowsForAddress(address: string) {
  return prisma.escrow.findMany({
    where: {
      OR: [
        { buyer: { equals: address, mode: "insensitive" } },
        { seller: { equals: address, mode: "insensitive" } },
      ],
    },
    select: {
      ...escrowDetailFields,
      milestones: {
        orderBy: { milestoneIndex: "asc" },
        select: publicMilestoneSelect,
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function findParticipantEscrowsForAddress(address: string) {
  return prisma.escrow.findMany({
    where: {
      OR: [
        { buyer: { equals: address, mode: "insensitive" } },
        { seller: { equals: address, mode: "insensitive" } },
      ],
    },
    select: {
      ...escrowDetailFields,
      milestones: {
        orderBy: { milestoneIndex: "asc" },
        select: participantMilestoneSelect,
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function findAllEscrows() {
  return prisma.escrow.findMany({
    include: { milestones: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function seedEscrow(params: {
  escrowAddress: string;
  buyer: string;
  seller: string;
  token: string;
  totalAmount: string;
  milestoneCount: number;
  metadataHash: string | null;
  title: string | null;
  description: string | null;
  txHash: string | null;
  milestoneAmounts: string[];
}): Promise<void> {
  const {
    escrowAddress,
    buyer,
    seller,
    token,
    totalAmount,
    milestoneCount,
    metadataHash,
    title,
    description,
    txHash,
    milestoneAmounts,
  } = params;

  await prisma.$transaction(async (tx) => {
    await tx.escrow.upsert({
      where: { id: escrowAddress },
      create: {
        id: escrowAddress,
        buyer,
        seller,
        token,
        totalAmount,
        milestoneCount,
        metadataHash,
        title,
        description,
        txHash,
      },
      update: {
        buyer,
        seller,
        token,
        totalAmount,
        milestoneCount,
        metadataHash: metadataHash ?? undefined,
        title: title ?? undefined,
        description: description ?? undefined,
        txHash: txHash ?? undefined,
      },
    });

    for (let i = 0; i < milestoneAmounts.length; i++) {
      await tx.milestone.upsert({
        where: { escrowAddress_milestoneIndex: { escrowAddress, milestoneIndex: i } },
        create: { escrowAddress, milestoneIndex: i, amount: milestoneAmounts[i] },
        update: { amount: milestoneAmounts[i] },
      });
    }
  });
}

export async function saveMetadataForHash(
  metadataHash: string,
  title: string,
  description: string | null
): Promise<void> {
  const existing = await prisma.escrow.findFirst({ where: { metadataHash } });

  if (existing) {
    await prisma.escrow.update({
      where: { id: existing.id },
      data: { title, description },
    });
  } else {
    await prisma.projectMetadata.upsert({
      where: { metadataHash },
      create: { metadataHash, title, description },
      update: { title, description },
    });
  }
}

export async function updateEscrowTitle(escrowAddress: string, title: string): Promise<boolean> {
  const existing = await prisma.escrow.findFirst({
    where: { id: { equals: escrowAddress, mode: "insensitive" } },
    select: { id: true },
  });
  if (!existing) return false;

  await prisma.escrow.update({
    where: { id: existing.id },
    data: { title },
  });
  return true;
}
