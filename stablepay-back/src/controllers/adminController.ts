import type { Request, Response } from "express";
import { sanitize } from "../utils/sanitize";
import { prisma } from "../prisma";
import { findAllEscrows, findEscrowById } from "../services/escrowService";
import { findDisputedMilestones, findMilestone } from "../services/milestoneService";
import { lookupCompanies } from "../services/userService";
import { syncSingleEscrow } from "../listener";

export async function getAdminProjects(_req: Request, res: Response): Promise<void> {
  try {
    const escrows = await findAllEscrows();

    const addresses = [...new Set(escrows.flatMap((e) => [e.buyer, e.seller]))];
    const companyMap = await lookupCompanies(addresses);

    const result = escrows.map((e) => ({
      ...e,
      buyerCompany: companyMap[e.buyer.toLowerCase()] ?? null,
      sellerCompany: companyMap[e.seller.toLowerCase()] ?? null,
    }));

    res.json(result);
  } catch (err) {
    console.error("[API] GET /admin/projects failed", err);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
}

export async function getAdminDisputes(_req: Request, res: Response): Promise<void> {
  try {
    const disputes = await findDisputedMilestones();

    const addresses = [
      ...new Set(disputes.flatMap((d) => [d.escrow.buyer, d.escrow.seller])),
    ];
    const companyMap = await lookupCompanies(addresses);

    const result = disputes.map((d) => ({
      ...d,
      escrow: {
        ...d.escrow,
        buyerCompany: companyMap[d.escrow.buyer.toLowerCase()] ?? null,
        sellerCompany: companyMap[d.escrow.seller.toLowerCase()] ?? null,
      },
    }));

    res.json(result);
  } catch (err) {
    console.error("[API] GET /admin/disputes failed", err);
    res.status(500).json({ error: "Failed to fetch disputes" });
  }
}

export async function getAdminDisputeDetail(req: Request, res: Response): Promise<void> {
  try {
    const escrowAddress = req.params.escrowAddress as string;

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

    const companyMap = await lookupCompanies([escrow.buyer, escrow.seller]);

    res.json({
      ...escrow,
      buyerCompany: companyMap[escrow.buyer.toLowerCase()] ?? null,
      sellerCompany: companyMap[escrow.seller.toLowerCase()] ?? null,
    });
  } catch (err) {
    console.error("[API] GET /admin/disputes/:escrowAddress failed", err);
    res.status(500).json({ error: "Failed to fetch dispute detail" });
  }
}

/** The platform's written reason for a dispute decision. Saved once, after the resolve tx — it cannot be changed. */
export async function saveResolutionNote(req: Request, res: Response): Promise<void> {
  const escrowAddress = req.params.escrowAddress as string;
  const milestoneIndex = parseInt(req.params.index as string, 10);
  const { resolutionNote } = req.body as { resolutionNote: string };

  if (!/^0x[a-fA-F0-9]{40}$/.test(escrowAddress) || isNaN(milestoneIndex)) {
    res.status(400).json({ error: "Invalid params" });
    return;
  }

  const cleanNote = sanitize(resolutionNote);

  try {
    let milestone = await findMilestone(escrowAddress, milestoneIndex);
    if (!milestone) {
      res.status(404).json({ error: "Milestone not found" });
      return;
    }

    if (milestone.status === "DISPUTED") {
      // Called right after the resolve tx confirms — the listener may not have
      // processed the event yet. Force a fresh on-chain read before refusing.
      await syncSingleEscrow(escrowAddress);
      milestone = await findMilestone(escrowAddress, milestoneIndex);
    }

    const wasSettledDispute = !!milestone?.disputeOpenedAt && ["PAID", "REFUNDED", "RESOLVED"].includes(milestone.status);
    if (!milestone || !wasSettledDispute) {
      res.status(409).json({ error: "The dispute is not resolved on-chain yet" });
      return;
    }

    if (milestone.resolutionNote) {
      res.status(409).json({ error: "A decision note has already been saved" });
      return;
    }

    await prisma.milestone.update({
      where: { escrowAddress_milestoneIndex: { escrowAddress, milestoneIndex } },
      data: { resolutionNote: cleanNote },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[API] POST /admin/disputes/:escrowAddress/milestones/:index/resolution-note failed", err);
    res.status(500).json({ error: "Failed to save decision note" });
  }
}
