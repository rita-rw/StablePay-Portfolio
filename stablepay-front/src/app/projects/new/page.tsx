"use client";

import { useState, useEffect, useRef } from "react";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useWalletClient,
} from "wagmi";
import { parseUnits, keccak256, toBytes, decodeEventLog, getAddress } from "viem";
import { useRouter } from "next/navigation";
import EscrowFactoryABI from "@/abi/EscrowFactory.json";
import { validateMilestones, MAX_MILESTONES } from "@/lib/escrow-validation";
import { useFactoryConfig } from "@/hooks/useFactoryConfig";
import { useUser } from "@/hooks/useUser";
import { seedProject, saveProjectMetadata } from "@/services/projects";
import { FACTORY_ADDRESS, USDC_ADDRESS } from "@/lib/constants";
import { parseFactoryError, formatUSDC, calcFeeBase } from "@/lib/formatters";
import type { MilestoneInput } from "@/types/escrow";
import Link from "next/link";

export default function CreateProjectPage() {
  const { isConnected, address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const router = useRouter();
  const { safeMaxFeeBps } = useFactoryConfig();
  const { isRegistered, loading: userLoading } = useUser();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [sellerAddress, setSellerAddress] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<MilestoneInput[]>([
    { label: "", amount: "" },
  ]);

  const {
    writeContract,
    data: txHash,
    isPending,
    error,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess, data: receipt } =
    useWaitForTransactionReceipt({ hash: txHash });

  const escrowAddress = receipt?.logs
    .map((log) => {
      try {
        const decoded = decodeEventLog({
          abi: EscrowFactoryABI.abi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "EscrowCreated") {
          return (decoded.args as unknown as { escrow: `0x${string}` }).escrow;
        }
      } catch {
        // Not our event — other contracts may emit logs in the same tx
      }
      return null;
    })
    .find(Boolean);

  const seeded = useRef(false);
  useEffect(() => {
    if (!receipt || !isSuccess || seeded.current) return;
    seeded.current = true;

    type EscrowCreatedArgs = {
      escrow: `0x${string}`;
      buyer: `0x${string}`;
      seller: `0x${string}`;
      token: `0x${string}`;
      totalAmount: bigint;
      milestoneCount: bigint;
      metadataHash: `0x${string}`;
    };

    let args: EscrowCreatedArgs | null = null;

    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: EscrowFactoryABI.abi, data: log.data, topics: log.topics });
        if (decoded.eventName === "EscrowCreated") {
          args = decoded.args as unknown as EscrowCreatedArgs;
          break;
        }
      } catch {}
    }

    if (!args) return;

    const amounts = milestones
      .filter((m) => parseFloat(m.amount) > 0)
      .map((m) => parseUnits(m.amount, 6).toString());

    if (walletClient) {
      seedProject(walletClient, {
        escrowAddress: args.escrow,
        metadataHash: args.metadataHash,
        title: title || "Untitled Project",
        description: description || null,
        txHash: receipt.transactionHash,
      }).catch(() => {}); // listener is the fallback if this fails
    }
  }, [receipt, isSuccess]);

  const PLATFORM_FEE_BPS = 250n;

  // Parses a milestone's typed amount straight to USDC base units (6 decimals),
  // the same precision the contract works in — avoids the float rounding that
  // made the fee/seller-receives preview drift from the actual on-chain split.
  function toBaseUnits(amount: string): bigint {
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) return 0n;
    try {
      return parseUnits(amount, 6);
    } catch {
      return 0n;
    }
  }

  const totalAmount = milestones.reduce((sum, m) => sum + toBaseUnits(m.amount), 0n);
  const totalFees = calcFeeBase(totalAmount, PLATFORM_FEE_BPS);
  const totalToSeller = totalAmount - totalFees;

  function addMilestone() {
    if (milestones.length >= MAX_MILESTONES) return;
    setMilestones([...milestones, { label: "", amount: "" }]);
  }

  function removeMilestone(index: number) {
    if (milestones.length > 1) {
      setMilestones(milestones.filter((_, i) => i !== index));
    }
  }

  function updateMilestone(
    index: number,
    field: keyof MilestoneInput,
    value: string
  ) {
    const updated = [...milestones];
    updated[index] = { ...updated[index], [field]: value };
    setMilestones(updated);
  }

  async function handleSubmit() {
    if (!sellerAddress) {
      setValidationError("Seller address is required.");
      return;
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(sellerAddress)) {
      setValidationError("Invalid seller address — must be a valid Ethereum address (0x...).");
      return;
    }

    let normalizedSeller: `0x${string}`;
    try {
      normalizedSeller = getAddress(sellerAddress);
    } catch {
      setValidationError("Invalid seller address — checksum failed.");
      return;
    }

    if (normalizedSeller.toLowerCase() === address?.toLowerCase()) {
      setValidationError("The seller address cannot be your own wallet address.");
      return;
    }

    if (totalAmount === 0n) {
      setValidationError("Total budget must be greater than 0.");
      return;
    }

    const validation = validateMilestones(milestones);
    if (!validation.valid) {
      setValidationError(validation.error);
      return;
    }

    if (!safeMaxFeeBps) {
      setValidationError("Could not read fee config from contract. Make sure you are connected to Base Sepolia.");
      return;
    }

    setValidationError(null);

    const fundedMilestones = milestones.filter((m) => parseFloat(m.amount) > 0);
    const milestoneAmounts = fundedMilestones.map((m) => parseUnits(m.amount, 6));
    const milestoneLabels = fundedMilestones.map((m) => m.label.trim());

    const metadataHash = keccak256(
      toBytes(`${title || ""}:${description || ""}:${milestoneLabels.join("|")}`)
    ) as `0x${string}`;

    // Save metadata to backend BEFORE creating on-chain, so the listener can
    // match the title when EscrowCreated fires — even if the browser closes after tx.
    if (!walletClient) {
      setValidationError("Wallet not ready — please try again.");
      return;
    }
    try {
      const result = await saveProjectMetadata(walletClient, {
        title: title.trim() || "Untitled Project",
        description: description.trim() || null,
        metadataHash,
        milestoneLabels,
      });
      if (!result.ok) {
        setValidationError(result.error || "Failed to save project metadata — please try again.");
        return;
      }
    } catch {
      setValidationError("Failed to save project metadata — please try again.");
      return;
    }

    writeContract({
      address: FACTORY_ADDRESS,
      abi: EscrowFactoryABI.abi,
      functionName: "createEscrow",
      args: [
        normalizedSeller,
        USDC_ADDRESS,
        milestoneAmounts,
        metadataHash,
        safeMaxFeeBps,
      ],
    });
  }

  useEffect(() => {
    if (mounted && !isConnected) router.replace("/");
  }, [mounted, isConnected, router]);

  if (!mounted || !isConnected) return null;

  if (!userLoading && !isRegistered) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4">
        <p className="text-lg font-semibold text-zinc-900">Registration required</p>
        <p className="text-sm text-zinc-500">You need to register your company before creating a project.</p>
        <Link
          href="/register"
          className="rounded-xl px-6 py-3 text-sm font-semibold text-white hover:brightness-110 transition-all"
          style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)" }}
        >
          Register Now
        </Link>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="min-h-[calc(100vh-64px)] bg-zinc-50 flex items-start justify-center pt-24 px-4">
        <div className="w-full max-w-md text-center">
          <div className="rounded-2xl border border-zinc-300 bg-white p-10 shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 border border-emerald-200">
              <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <h1 className="text-2xl font-bold text-zinc-900 mb-2">Project Created!</h1>
            <p className="text-sm text-zinc-500 mb-4">
              Transaction confirmed. Your escrow contract has been deployed.
            </p>
            {escrowAddress && (
              <p className="font-mono text-xs text-zinc-400 mb-1">
                Escrow: {escrowAddress.slice(0, 6)}...{escrowAddress.slice(-4)}
              </p>
            )}
            <p className="font-mono text-xs text-zinc-400 mb-6">
              Tx: {txHash?.slice(0, 10)}...{txHash?.slice(-8)}
            </p>
            <div className="flex justify-center gap-3">
              {escrowAddress && (
                <button
                  onClick={() => router.push(`/projects/${escrowAddress}`)}
                  className="rounded-xl px-6 py-2.5 text-sm font-semibold text-white hover:brightness-110 transition-all"
                  style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)" }}
                >
                  Fund Project →
                </button>
              )}
              <button
                onClick={() => router.push("/projects")}
                className="rounded-xl border border-zinc-200 px-6 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
              >
                My Projects
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const inputClass = "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all";

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <button
          onClick={() => router.push("/projects")}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
        >
          ← Back to Projects
        </button>

        <div className="rounded-2xl border border-zinc-400/60 bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.10)] space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Create New Project</h1>
            <p className="text-sm text-zinc-500 mt-1">Define milestones, set amounts and specify the seller&apos;s wallet.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-900">Project Title</label>
            <input
              type="text"
              placeholder="e.g. Website redesign"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              className={inputClass}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-900">Seller Address</label>
            <input
              type="text"
              placeholder="0x..."
              value={sellerAddress}
              onChange={(e) => setSellerAddress(e.target.value)}
              maxLength={42}
              className={inputClass}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-900">Project Description</label>
            <textarea
              placeholder="Describe the project..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              className={inputClass}
            />
          </div>

          <div>
            <label className="mb-3 block text-sm font-medium text-zinc-900">Milestones</label>
            <div className="space-y-3">
              {milestones.map((m, i) => {
                const amountBase = toBaseUnits(m.amount);
                const hasAmount = amountBase > 0n;
                const fee = hasAmount ? calcFeeBase(amountBase, PLATFORM_FEE_BPS) : 0n;
                const toSeller = hasAmount ? amountBase - fee : 0n;
                return (
                  <div key={i} className="rounded-xl border border-zinc-300 bg-white overflow-hidden">
                    <div className="flex gap-2 p-3">
                      <input
                        type="text"
                        placeholder={`Milestone ${i + 1}`}
                        value={m.label}
                        onChange={(e) => updateMilestone(i, "label", e.target.value)}
                        maxLength={100}
                        className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      />
                      <input
                        type="number"
                        placeholder="USDC"
                        value={m.amount}
                        onChange={(e) => updateMilestone(i, "amount", e.target.value)}
                        className="w-28 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      />
                      {milestones.length > 1 && (
                        <button
                          onClick={() => removeMilestone(i)}
                          className="rounded-lg px-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    {hasAmount && (
                      <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-100 px-4 py-2">
                        <span className="text-xs text-zinc-400">2.5% fee: <span className="font-medium text-zinc-500">{formatUSDC(fee)} USDC</span></span>
                        <span className="text-xs font-semibold text-emerald-700">Seller receives: {formatUSDC(toSeller)} USDC</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {milestones.length < MAX_MILESTONES && (
              <button
                onClick={addMilestone}
                className="mt-3 text-sm font-medium text-primary hover:underline"
              >
                + Add milestone
              </button>
            )}
            {milestones.length >= MAX_MILESTONES && (
              <p className="mt-2 text-xs text-zinc-500">Maximum {MAX_MILESTONES} milestones reached.</p>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">You pay (total)</span>
              <span className="text-sm font-semibold text-zinc-900">{formatUSDC(totalAmount)} USDC</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">Platform fee (2.5%)</span>
              <span className="text-sm text-zinc-500">− {formatUSDC(totalFees)} USDC</span>
            </div>
            <div className="border-t border-zinc-200 pt-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-900">Seller receives</span>
              <span className="text-lg font-bold text-emerald-700">{formatUSDC(totalToSeller)} <span className="text-sm font-medium">USDC</span></span>
            </div>
          </div>

          {validationError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm text-red-600">{validationError}</p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm text-red-600">{parseFactoryError(error)}</p>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={isPending || isConfirming}
            className="w-full rounded-xl py-3 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)" }}
          >
            {isPending
              ? "Confirm in Wallet..."
              : isConfirming
                ? "Waiting for Confirmation..."
                : "Create Project"}
          </button>
        </div>
      </div>
    </div>
  );
}
