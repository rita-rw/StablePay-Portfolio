"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { BASESCAN_URL } from "@/lib/constants";
import { shortAddr } from "@/lib/formatters";

type ProjectInfoCardProps = {
  escrowAddress: string;
  counterpartyRole: "Buyer" | "Seller";
  counterpartyAddress: string;
  counterpartyCompany?: string | null;
  status: { label: string; color: string };
  totalAmount: string;
  milestoneCount: number;
};

/** Summary card at the top of a project: counterparty, status, amount and escrow address. */
export function ProjectInfoCard({
  escrowAddress,
  counterpartyRole,
  counterpartyAddress,
  counterpartyCompany,
  status,
  totalAmount,
  milestoneCount,
}: ProjectInfoCardProps) {
  const [copied, setCopied] = useState(false);

  async function copyEscrowAddress() {
    try {
      await navigator.clipboard.writeText(escrowAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard denied — address is still selectable in the UI
    }
  }

  return (
    <div className="mb-6 rounded-2xl border border-zinc-300 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.08)]">
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs font-medium text-zinc-500 mb-1">Counterparty ({counterpartyRole})</p>
          <p className="text-sm font-medium text-zinc-900">
            {counterpartyCompany ? (
              <>{counterpartyCompany} <span className="font-mono text-xs text-zinc-400">{shortAddr(counterpartyAddress)}</span></>
            ) : (
              <span className="font-mono">{shortAddr(counterpartyAddress)}</span>
            )}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-zinc-500 mb-1">Status</p>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border ${status.color}`}>
            {status.label}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-zinc-100">
        <div>
          <p className="text-xs font-medium text-zinc-500 mb-1">Total Amount</p>
          <p className="text-xl font-bold text-zinc-900">{totalAmount} USDC</p>
        </div>
        <div>
          <p className="text-xs font-medium text-zinc-500 mb-1">Milestones</p>
          <p className="text-xl font-bold text-zinc-900">{milestoneCount}</p>
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-zinc-100">
        <p className="text-xs font-medium text-zinc-500 mb-1">Escrow Address</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="font-mono text-xs text-zinc-700">{escrowAddress}</p>
          <button
            type="button"
            onClick={() => void copyEscrowAddress()}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
            aria-label="Copy escrow address"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={`${BASESCAN_URL}/address/${escrowAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900"
          >
            View on Basescan ↗
          </a>
        </div>
      </div>
    </div>
  );
}
