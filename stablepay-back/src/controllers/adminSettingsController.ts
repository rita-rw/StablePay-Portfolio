import type { Request, Response } from "express";
import { getAddress } from "viem";
import { publicClient } from "../utils/viemClient";
import { walletClient, walletPublicClient } from "../utils/walletClient";
import { factoryReadAbi } from "../abi/EscrowFactory.read.abi";
import { factoryWriteAbi } from "../abi/EscrowFactory.write.abi";

function getFactoryAddress() {
  return getAddress(process.env.FACTORY_ADDRESS as string);
}

export async function getFactorySettings(_req: Request, res: Response): Promise<void> {
  try {
    const [platformFeeBps, defaultAutoApprovalDays, defaultDisputeTimeoutDays, defaultCorrectionWindowDays] =
      await Promise.all([
        publicClient.readContract({ address: getFactoryAddress(), abi: factoryReadAbi, functionName: "platformFeeBps" }),
        publicClient.readContract({ address: getFactoryAddress(), abi: factoryReadAbi, functionName: "defaultAutoApprovalDays" }),
        publicClient.readContract({ address: getFactoryAddress(), abi: factoryReadAbi, functionName: "defaultDisputeTimeoutDays" }),
        publicClient.readContract({ address: getFactoryAddress(), abi: factoryReadAbi, functionName: "defaultCorrectionWindowDays" }),
      ]);

    res.json({
      platformFeeBps: Number(platformFeeBps),
      defaultAutoApprovalDays: Number(defaultAutoApprovalDays),
      defaultDisputeTimeoutDays: Number(defaultDisputeTimeoutDays),
      defaultCorrectionWindowDays: Number(defaultCorrectionWindowDays),
    });
  } catch (err) {
    console.error("[API] GET /admin/settings failed", err);
    res.status(500).json({ error: "Failed to fetch factory settings" });
  }
}

export async function updatePlatformFee(req: Request, res: Response): Promise<void> {
  try {
    const { feeBps } = req.body as { feeBps: number };

    const txHash = await walletClient.writeContract({
      address: getFactoryAddress(),
      abi: factoryWriteAbi,
      functionName: "setPlatformFeeBps",
      args: [BigInt(feeBps)],
    });

    await walletPublicClient.waitForTransactionReceipt({ hash: txHash });
    res.json({ ok: true, txHash });
  } catch (err) {
    console.error("[API] POST /admin/settings/fee failed", err);
    res.status(500).json({ error: "Failed to update platform fee" });
  }
}

export async function updateAutoApprovalDays(req: Request, res: Response): Promise<void> {
  try {
    const { days } = req.body as { days: number };

    const txHash = await walletClient.writeContract({
      address: getFactoryAddress(),
      abi: factoryWriteAbi,
      functionName: "setDefaultAutoApprovalDays",
      args: [BigInt(days)],
    });

    await walletPublicClient.waitForTransactionReceipt({ hash: txHash });
    res.json({ ok: true, txHash });
  } catch (err) {
    console.error("[API] POST /admin/settings/auto-approval failed", err);
    res.status(500).json({ error: "Failed to update auto-approval days" });
  }
}

export async function updateDisputeTimeoutDays(req: Request, res: Response): Promise<void> {
  try {
    const { days } = req.body as { days: number };

    const txHash = await walletClient.writeContract({
      address: getFactoryAddress(),
      abi: factoryWriteAbi,
      functionName: "setDefaultDisputeTimeoutDays",
      args: [BigInt(days)],
    });

    await walletPublicClient.waitForTransactionReceipt({ hash: txHash });
    res.json({ ok: true, txHash });
  } catch (err) {
    console.error("[API] POST /admin/settings/dispute-timeout failed", err);
    res.status(500).json({ error: "Failed to update dispute timeout days" });
  }
}

export async function updateCorrectionWindowDays(req: Request, res: Response): Promise<void> {
  try {
    const { days } = req.body as { days: number };

    const txHash = await walletClient.writeContract({
      address: getFactoryAddress(),
      abi: factoryWriteAbi,
      functionName: "setDefaultCorrectionWindowDays",
      args: [BigInt(days)],
    });

    await walletPublicClient.waitForTransactionReceipt({ hash: txHash });
    res.json({ ok: true, txHash });
  } catch (err) {
    console.error("[API] POST /admin/settings/correction-window failed", err);
    res.status(500).json({ error: "Failed to update correction window days" });
  }
}

export async function addApprovedToken(req: Request, res: Response): Promise<void> {
  try {
    const { tokenAddress } = req.body as { tokenAddress: `0x${string}` };

    const txHash = await walletClient.writeContract({
      address: getFactoryAddress(),
      abi: factoryWriteAbi,
      functionName: "approveToken",
      args: [tokenAddress],
    });

    await walletPublicClient.waitForTransactionReceipt({ hash: txHash });
    res.json({ ok: true, txHash });
  } catch (err) {
    console.error("[API] POST /admin/settings/tokens/approve failed", err);
    res.status(500).json({ error: "Failed to approve token" });
  }
}

export async function deleteApprovedToken(req: Request, res: Response): Promise<void> {
  try {
    const { tokenAddress } = req.body as { tokenAddress: `0x${string}` };

    const txHash = await walletClient.writeContract({
      address: getFactoryAddress(),
      abi: factoryWriteAbi,
      functionName: "removeToken",
      args: [tokenAddress],
    });

    await walletPublicClient.waitForTransactionReceipt({ hash: txHash });
    res.json({ ok: true, txHash });
  } catch (err) {
    console.error("[API] POST /admin/settings/tokens/remove failed", err);
    res.status(500).json({ error: "Failed to remove token" });
  }
}
