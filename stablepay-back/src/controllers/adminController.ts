import type { Request, Response } from "express";
import { findAllEscrows, findEscrowById } from "../services/escrowService";
import { findDisputedMilestones } from "../services/milestoneService";
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
