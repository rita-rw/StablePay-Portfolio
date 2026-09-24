import type { Response } from "express";
import type { AuthRequest } from "../auth";
import { getAddress } from "viem";
import { sanitize } from "../utils/sanitize";
import { prisma } from "../prisma";
import { publicClient } from "../utils/viemClient";
import { factoryReadAbi } from "../abi/EscrowFactory.read.abi";
import { escrowReadAbi } from "../abi/StablePayEscrow.read.abi";
import {
  findEscrowById,
  findEscrowByMetadataHash,
  findEscrowPartiesById,
  findParticipantEscrowById,
  findPublicEscrowById,
  findPublicEscrowsForAddress,
  findParticipantEscrowsForAddress,
  seedEscrow,
  saveMetadataForHash,
  updateEscrowTitle,
} from "../services/escrowService";
import {
  findMilestone,
  getParticipantMilestonesByEscrow,
  getPublicMilestonesByEscrow,
  updateMilestoneDelivery,
  updateMilestoneDisputeReason,
} from "../services/milestoneService";
import { lookupCompanies } from "../services/userService";
import { syncSingleEscrow } from "../listener";

function isParticipant(signerAddress: string | undefined, escrow: { buyer: string; seller: string }): boolean {
  if (!signerAddress) return false;
  return [escrow.buyer, escrow.seller].some((p) => p.toLowerCase() === signerAddress.toLowerCase());
}

function isPlatformSigner(signerAddress: string | undefined): boolean {
  const platform = process.env.PLATFORM_ADDRESS;
  if (!signerAddress || !platform) return false;
  return signerAddress.toLowerCase() === platform.toLowerCase();
}

/** Buyer, seller, or platform — may see delivery refs, dispute reasons, awards, etc. */
function canViewPrivateEscrowData(
  signerAddress: string | undefined,
  escrow: { buyer: string; seller: string },
): boolean {
  return isParticipant(signerAddress, escrow) || isPlatformSigner(signerAddress);
}

export async function seedProject(req: AuthRequest, res: Response): Promise<void> {
  const { escrowAddress, metadataHash, title, description, txHash } = req.body;

  const factoryAddress = process.env.FACTORY_ADDRESS as `0x${string}` | undefined;
  if (!factoryAddress) {
    res.status(500).json({ error: "FACTORY_ADDRESS not configured" });
    return;
  }

  const normalizedEscrowAddress = getAddress(escrowAddress);

  // ── Step 1: Verify escrow is from our factory (retry once for RPC lag) ──
  try {
    let isValid = await publicClient.readContract({
      address: factoryAddress,
      abi: factoryReadAbi,
      functionName: "isValidEscrow",
      args: [normalizedEscrowAddress],
    });

    if (!isValid) {
      // RPC may lag behind chain tip — wait and retry once before rejecting
      await new Promise((r) => setTimeout(r, 3000));
      isValid = await publicClient.readContract({
        address: factoryAddress,
        abi: factoryReadAbi,
        functionName: "isValidEscrow",
        args: [normalizedEscrowAddress],
      });
    }

    if (!isValid) {
      res.status(403).json({ error: "Escrow not registered in factory" });
      return;
    }
  } catch (err) {
    console.error("[API] Factory verification failed for seed", err);
    res.status(502).json({ error: "On-chain verification failed" });
    return;
  }

  // ── Step 2: Read ALL authoritative fields from chain in parallel ──
  let authoritativeSeed: {
    buyer: string;
    seller: string;
    token: string;
    totalAmount: string;
    milestoneCount: number;
    milestoneAmounts: string[];
  };

  try {
    const [onChainBuyer, onChainSeller, onChainToken, onChainTotalAmount, onChainMilestoneCount] = await Promise.all([
      publicClient.readContract({ address: normalizedEscrowAddress, abi: escrowReadAbi, functionName: "BUYER" }),
      publicClient.readContract({ address: normalizedEscrowAddress, abi: escrowReadAbi, functionName: "SELLER" }),
      publicClient.readContract({ address: normalizedEscrowAddress, abi: escrowReadAbi, functionName: "TOKEN" }),
      publicClient.readContract({ address: normalizedEscrowAddress, abi: escrowReadAbi, functionName: "totalAmount" }),
      publicClient.readContract({ address: normalizedEscrowAddress, abi: escrowReadAbi, functionName: "milestoneCount" }),
    ]);

    const count = Number(onChainMilestoneCount);
    const milestoneResults = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        publicClient.readContract({
          address: normalizedEscrowAddress,
          abi: escrowReadAbi,
          functionName: "milestones",
          args: [BigInt(i)],
        })
      )
    );

    authoritativeSeed = {
      buyer: getAddress(onChainBuyer as string),
      seller: getAddress(onChainSeller as string),
      token: getAddress(onChainToken as string),
      totalAmount: (onChainTotalAmount as bigint).toString(),
      milestoneCount: count,
      milestoneAmounts: milestoneResults.map((r) => (r as readonly [bigint, ...unknown[]])[0].toString()),
    };
  } catch (err) {
    console.warn("[API] Authoritative seed chain reads not ready", {
      escrowAddress: normalizedEscrowAddress,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(409).json({ error: "Escrow chain state not available yet. Please retry shortly." });
    return;
  }

  // ── Step 3: Verify signer is the buyer ──
  if (authoritativeSeed.buyer !== getAddress(req.signerAddress!)) {
    res.status(403).json({ error: "Only the buyer can seed this project" });
    return;
  }

  const cleanTitle = title ? sanitize(title) : null;
  const cleanDescription = description ? sanitize(description) : null;

  // ── Step 4: Write to DB — only title/description/metadataHash/txHash from client ──
  try {
    await seedEscrow({
      escrowAddress: normalizedEscrowAddress,
      buyer: authoritativeSeed.buyer,
      seller: authoritativeSeed.seller,
      token: authoritativeSeed.token,
      totalAmount: authoritativeSeed.totalAmount,
      milestoneCount: authoritativeSeed.milestoneCount,
      metadataHash: metadataHash || null,
      title: cleanTitle,
      description: cleanDescription,
      txHash: txHash || null,
      milestoneAmounts: authoritativeSeed.milestoneAmounts,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[API] POST /projects/seed failed", err);
    res.status(500).json({ error: "Failed to seed project" });
  }
}

export async function saveMetadata(req: AuthRequest, res: Response): Promise<void> {
  const { title, description, metadataHash } = req.body;

  const cleanTitle = sanitize(title);
  const cleanDescription = description ? sanitize(description) : null;

  try {
    // If an escrow already exists with this hash, verify the signer is the buyer
    const existing = await findEscrowByMetadataHash(metadataHash);
    if (existing && req.signerAddress?.toLowerCase() !== existing.buyer.toLowerCase()) {
      res.status(403).json({ error: "Only the buyer can update metadata" });
      return;
    }

    await saveMetadataForHash(metadataHash, cleanTitle, cleanDescription);
    res.json({ ok: true });
  } catch (err) {
    console.error("[API] POST /projects/metadata failed", err);
    res.status(500).json({ error: "Failed to save metadata" });
  }
}

export async function renameProjectTitle(req: AuthRequest, res: Response): Promise<void> {
  const escrowAddress = req.params.escrowAddress as string;

  if (!/^0x[a-fA-F0-9]{40}$/.test(escrowAddress)) {
    res.status(400).json({ error: "Invalid Ethereum address" });
    return;
  }

  const cleanTitle = sanitize(req.body.title);
  if (!cleanTitle) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  try {
    const parties = await findEscrowPartiesById(escrowAddress);
    if (!parties) {
      res.status(404).json({ error: "Escrow not found" });
      return;
    }

    if (req.signerAddress?.toLowerCase() !== parties.buyer.toLowerCase()) {
      res.status(403).json({ error: "Only the buyer can rename this project" });
      return;
    }

    const updated = await updateEscrowTitle(escrowAddress, cleanTitle);
    if (!updated) {
      res.status(404).json({ error: "Escrow not found" });
      return;
    }

    res.json({ ok: true, title: cleanTitle });
  } catch (err) {
    console.error("[API] PATCH /projects/:escrowAddress/title failed", err);
    res.status(500).json({ error: "Failed to rename project" });
  }
}

export async function getProjectDetail(req: AuthRequest, res: Response): Promise<void> {
  const escrowAddress = req.params.escrowAddress as string;

  if (!/^0x[a-fA-F0-9]{40}$/.test(escrowAddress)) {
    res.status(400).json({ error: "Invalid Ethereum address" });
    return;
  }

  try {
    await syncSingleEscrow(escrowAddress);
    const parties = await findEscrowPartiesById(escrowAddress);
    if (!parties) {
      res.status(404).json({ error: "Escrow not found" });
      return;
    }

    const participantView = canViewPrivateEscrowData(req.signerAddress, parties);
    const escrow = participantView
      ? await findParticipantEscrowById(escrowAddress)
      : await findPublicEscrowById(escrowAddress);

    if (!escrow) {
      res.status(404).json({ error: "Escrow not found" });
      return;
    }

    if (!participantView) {
      res.json(escrow);
      return;
    }

    const companyMap = await lookupCompanies([escrow.buyer, escrow.seller]);
    res.json({
      ...escrow,
      buyerCompany: companyMap[escrow.buyer.toLowerCase()] ?? null,
      sellerCompany: companyMap[escrow.seller.toLowerCase()] ?? null,
    });
  } catch (err) {
    console.error("[API] GET /projects/detail/:escrowAddress failed", err);
    res.status(500).json({ error: "Failed to fetch escrow" });
  }
}

export async function getProjectsByAddress(req: AuthRequest, res: Response): Promise<void> {
  const address = req.params.address as string;

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    res.status(400).json({ error: "Invalid Ethereum address" });
    return;
  }

  try {
    const normalizedAddress = getAddress(address);
    const isSelf = req.signerAddress?.toLowerCase() === normalizedAddress.toLowerCase();
    const escrows = isSelf
      ? await findParticipantEscrowsForAddress(normalizedAddress)
      : await findPublicEscrowsForAddress(normalizedAddress);

    if (!isSelf) {
      res.json(escrows);
      return;
    }

    const addresses = [...new Set(escrows.flatMap((e) => [e.buyer, e.seller]))];
    const companyMap = await lookupCompanies(addresses);
    res.json(escrows.map((e) => ({
      ...e,
      buyerCompany: companyMap[e.buyer.toLowerCase()] ?? null,
      sellerCompany: companyMap[e.seller.toLowerCase()] ?? null,
    })));
  } catch (err) {
    console.error("[API] /projects/:address failed", err);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
}

export async function getMilestones(req: AuthRequest, res: Response): Promise<void> {
  const escrowAddress = req.params.escrowAddress as string;

  if (!/^0x[a-fA-F0-9]{40}$/.test(escrowAddress)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }

  try {
    const parties = await findEscrowPartiesById(escrowAddress);
    if (!parties) {
      res.status(404).json({ error: "Escrow not found" });
      return;
    }

    const milestones = canViewPrivateEscrowData(req.signerAddress, parties)
      ? await getParticipantMilestonesByEscrow(escrowAddress)
      : await getPublicMilestonesByEscrow(escrowAddress);

    res.json(milestones);
  } catch (err) {
    console.error("[API] GET /projects/:escrowAddress/milestones failed", err);
    res.status(500).json({ error: "Failed to fetch milestones" });
  }
}

export async function getEvents(req: AuthRequest, res: Response): Promise<void> {
  const escrowAddress = req.params.escrowAddress as string;

  if (!/^0x[a-fA-F0-9]{40}$/.test(escrowAddress)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }

  try {
    try {
      await syncSingleEscrow(escrowAddress);
    } catch (syncErr) {
      console.error("[API] syncSingleEscrow failed for", escrowAddress, syncErr);
    }

    const escrow = await findEscrowById(escrowAddress);

    if (!escrow) {
      res.status(404).json({ error: "Escrow not found" });
      return;
    }

    type ProjectEvent = {
      type: string;
      timestamp: Date;
      milestoneIndex: number | null;
    };

    const events: ProjectEvent[] = [];

    events.push({ type: "project_created", timestamp: escrow.createdAt, milestoneIndex: null });

    if (escrow.sellerAcceptedAt) {
      events.push({ type: "seller_accepted", timestamp: escrow.sellerAcceptedAt, milestoneIndex: null });
    } else if (["SELLER_ACCEPTED", "FUNDED"].includes(escrow.status)) {
      events.push({ type: "seller_accepted", timestamp: escrow.createdAt, milestoneIndex: null });
    }

    if (escrow.fundedAt) {
      events.push({ type: "project_funded", timestamp: escrow.fundedAt, milestoneIndex: null });
    } else if (escrow.status === "FUNDED") {
      events.push({ type: "project_funded", timestamp: escrow.createdAt, milestoneIndex: null });
    }

    for (const milestone of escrow.milestones) {
      if (milestone.submittedAt) {
        events.push({ type: "milestone_submitted", timestamp: milestone.submittedAt, milestoneIndex: milestone.milestoneIndex });
      } else if (["SUBMITTED", "DISPUTED", "ESCALATED", "PAID", "REFUNDED", "RESOLVED"].includes(milestone.status)) {
        events.push({ type: "milestone_submitted", timestamp: escrow.createdAt, milestoneIndex: milestone.milestoneIndex });
      }

      if (milestone.disputeOpenedAt) {
        events.push({ type: "dispute_opened", timestamp: milestone.disputeOpenedAt, milestoneIndex: milestone.milestoneIndex });
      } else if (["DISPUTED", "ESCALATED"].includes(milestone.status)) {
        events.push({ type: "dispute_opened", timestamp: escrow.createdAt, milestoneIndex: milestone.milestoneIndex });
      }

      if (milestone.disputeEscalatedAt) {
        events.push({
          type: "dispute_escalated",
          timestamp: milestone.disputeEscalatedAt,
          milestoneIndex: milestone.milestoneIndex,
        });
      } else if (milestone.isEscalated || milestone.status === "ESCALATED") {
        // Escalated before disputeEscalatedAt was reliably stored — place after dispute open.
        events.push({
          type: "dispute_escalated",
          timestamp: milestone.disputeOpenedAt ?? escrow.createdAt,
          milestoneIndex: milestone.milestoneIndex,
        });
      }

      if (milestone.paidAt) {
        if (milestone.disputeOpenedAt && ["PAID", "REFUNDED", "RESOLVED"].includes(milestone.status)) {
          events.push({ type: "dispute_resolved_platform", timestamp: milestone.paidAt, milestoneIndex: milestone.milestoneIndex });
        } else if (milestone.status === "PAID") {
          events.push({ type: "milestone_approved", timestamp: milestone.paidAt, milestoneIndex: milestone.milestoneIndex });
        } else if (milestone.status === "REFUNDED") {
          events.push({ type: "milestone_refunded", timestamp: milestone.paidAt, milestoneIndex: milestone.milestoneIndex });
        } else if (milestone.status === "RESOLVED") {
          events.push({ type: "dispute_resolved", timestamp: milestone.paidAt, milestoneIndex: milestone.milestoneIndex });
        }
      }
    }

    events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    res.json(events);
  } catch (err) {
    console.error("[API] GET /projects/:escrowAddress/events failed", err);
    res.status(500).json({ error: "Failed to fetch events" });
  }
}

export async function saveDelivery(req: AuthRequest, res: Response): Promise<void> {
  const escrowAddress = req.params.escrowAddress as string;
  const milestoneIndex = parseInt(req.params.index as string, 10);
  const { deliveryReference } = req.body;

  if (!/^0x[a-fA-F0-9]{40}$/.test(escrowAddress) || isNaN(milestoneIndex)) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }

  const cleanDelivery = sanitize(deliveryReference);

  try {
    const escrow = await findEscrowById(escrowAddress);
    if (!escrow) {
      res.status(404).json({ error: "Escrow not found" });
      return;
    }

    if (req.signerAddress?.toLowerCase() !== escrow.seller.toLowerCase()) {
      res.status(403).json({ error: "Only the seller can submit delivery" });
      return;
    }

    let milestone = await findMilestone(escrowAddress, milestoneIndex);
    if (!milestone) {
      res.status(404).json({ error: "Milestone not found" });
      return;
    }

    if (!["SUBMITTED", "DISPUTED"].includes(milestone.status)) {
      // The frontend calls this right after the on-chain submit tx confirms — the
      // listener may not have processed the MilestoneSubmitted event yet. Force a
      // fresh on-chain read before treating this as a genuine conflict.
      await syncSingleEscrow(escrowAddress);
      milestone = await findMilestone(escrowAddress, milestoneIndex);

      if (!milestone || !["SUBMITTED", "DISPUTED"].includes(milestone.status)) {
        res.status(409).json({ error: `Cannot deliver on a ${milestone?.status ?? "missing"} milestone` });
        return;
      }
    }

    await updateMilestoneDelivery(escrowAddress, milestoneIndex, cleanDelivery);

    res.json({ ok: true });
  } catch (err) {
    console.error("[API] POST /projects/:escrowAddress/milestones/:index/delivery failed", err);
    res.status(500).json({ error: "Failed to save delivery reference" });
  }
}

export async function saveDisputeReason(req: AuthRequest, res: Response): Promise<void> {
  const escrowAddress = req.params.escrowAddress as string;
  const milestoneIndex = parseInt(req.params.index as string, 10);
  const { disputeReason } = req.body;

  if (!/^0x[a-fA-F0-9]{40}$/.test(escrowAddress) || isNaN(milestoneIndex)) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }

  const cleanReason = sanitize(disputeReason);

  try {
    const escrow = await findEscrowById(escrowAddress);
    if (!escrow) {
      res.status(404).json({ error: "Escrow not found" });
      return;
    }

    if (req.signerAddress?.toLowerCase() !== escrow.buyer.toLowerCase()) {
      res.status(403).json({ error: "Only the buyer can file a dispute reason" });
      return;
    }

    let milestone = await findMilestone(escrowAddress, milestoneIndex);
    if (!milestone) {
      res.status(404).json({ error: "Milestone not found" });
      return;
    }

    if (!["SUBMITTED", "DISPUTED"].includes(milestone.status)) {
      // Same race as saveDelivery: the frontend calls this right after the on-chain
      // dispute tx confirms, before the listener may have processed the event.
      await syncSingleEscrow(escrowAddress);
      milestone = await findMilestone(escrowAddress, milestoneIndex);

      if (!milestone || !["SUBMITTED", "DISPUTED"].includes(milestone.status)) {
        res.status(409).json({ error: `Cannot dispute a ${milestone?.status ?? "missing"} milestone` });
        return;
      }
    }

    await updateMilestoneDisputeReason(escrowAddress, milestoneIndex, cleanReason);

    res.json({ ok: true });
  } catch (err) {
    console.error("[API] POST /projects/:escrowAddress/milestones/:index/dispute failed", err);
    res.status(500).json({ error: "Failed to save dispute reason" });
  }
}

export async function saveEscalationReason(req: AuthRequest, res: Response): Promise<void> {
  const escrowAddress = req.params.escrowAddress as string;
  const milestoneIndex = parseInt(req.params.index as string, 10);
  const { escalationReason } = req.body as { escalationReason?: unknown };

  if (!/^0x[a-fA-F0-9]{40}$/.test(escrowAddress) || isNaN(milestoneIndex)) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }

  const cleanReason = sanitize(String(escalationReason ?? "")).slice(0, 500);

  try {
    const escrow = await findEscrowById(escrowAddress);
    if (!escrow) {
      res.status(404).json({ error: "Escrow not found" });
      return;
    }

    if (req.signerAddress?.toLowerCase() !== escrow.seller.toLowerCase()) {
      res.status(403).json({ error: "Only the seller can submit an escalation reason" });
      return;
    }

    const milestone = await findMilestone(escrowAddress, milestoneIndex);
    if (!milestone) {
      res.status(404).json({ error: "Milestone not found" });
      return;
    }

    await prisma.milestone.update({
      where: { escrowAddress_milestoneIndex: { escrowAddress, milestoneIndex } },
      data: { escalationReason: cleanReason || null },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[API] POST /projects/:escrowAddress/milestones/:index/escalation-reason failed", err);
    res.status(500).json({ error: "Failed to save escalation reason" });
  }
}
