"use client";

import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { formatUnits } from "viem";
import { useWalletClient } from "wagmi";
import { fetchProjectDetail } from "@/services/projects";
import { fetchUser } from "@/services/users";
import { BASESCAN_URL } from "@/lib/constants";
import { decodeTitle } from "@/lib/formatters";
import type { Milestone } from "@/types/escrow";

type ReceiptEscrow = {
  id: string;
  buyer: string;
  seller: string;
  totalAmount: string;
  title?: string | null;
  txHash?: string | null;
  fundedTxHash?: string | null;
  createdAt: string;
  milestones: (Milestone & { amount: string })[];
};

type UserProfile = {
  companyName?: string | null;
};

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: walletClient } = useWalletClient();
  const [escrow, setEscrow] = useState<ReceiptEscrow | null>(null);
  const [buyerProfile, setBuyerProfile] = useState<UserProfile | null>(null);
  const [sellerProfile, setSellerProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetchProjectDetail(id, walletClient ?? undefined)
      .then(async (data: ReceiptEscrow | null) => {
        setEscrow(data);
        if (data) {
          const [b, s] = await Promise.all([
            fetchUser(data.buyer).catch(() => null),
            fetchUser(data.seller).catch(() => null),
          ]);
          setBuyerProfile(b);
          setSellerProfile(s);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id, walletClient]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <p className="text-sm text-zinc-500">Loading receipt...</p>
      </div>
    );
  }

  if (!escrow) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <p className="text-sm text-zinc-500">Project not found.</p>
      </div>
    );
  }

  // Arwin's corrected receipt math
  const totalToSeller = escrow.milestones.reduce((sum, m) => {
    const amt = BigInt(m.amount);
    const hadDispute = m.disputeOpenedAt != null;
    if (m.status === "PAID") {
      if (hadDispute && m.sellerAward) {
        const award = BigInt(m.sellerAward);
        return sum + award - (award * BigInt(250)) / BigInt(10000);
      }
      return sum + amt - (amt * BigInt(250)) / BigInt(10000);
    }
    if (m.status === "RESOLVED" && m.sellerAward) {
      const award = BigInt(m.sellerAward);
      return sum + award - (award * BigInt(250)) / BigInt(10000);
    }
    return sum;
  }, BigInt(0));

  const totalRefunded = escrow.milestones.reduce((sum, m) => {
    const amt = BigInt(m.amount);
    if (m.status === "REFUNDED") {
      return sum + amt - (amt * BigInt(100)) / BigInt(10000);
    }
    return sum;
  }, BigInt(0));

  const totalEscrowed = escrow.milestones
    .filter((m) => m.status === "PAID" || m.status === "RESOLVED")
    .reduce((sum, m) => sum + BigInt(m.amount), BigInt(0));

  const platformFees = escrow.milestones.reduce((sum, m) => {
    const amt = BigInt(m.amount);
    if (m.status === "PAID") {
      const hadDispute = m.disputeOpenedAt != null;
      const base = (hadDispute && m.sellerAward) ? BigInt(m.sellerAward) : amt;
      return sum + (base * BigInt(250)) / BigInt(10000);
    }
    if (m.status === "RESOLVED" && m.sellerAward) {
      const award = BigInt(m.sellerAward);
      return sum + (award * BigInt(250)) / BigInt(10000);
    }
    return sum;
  }, BigInt(0));

  const totalDisputeFees = escrow.milestones.reduce((sum, m) => {
    const amt = BigInt(m.amount);
    const hadDispute = m.disputeOpenedAt != null;
    if (m.status === "RESOLVED" || m.status === "REFUNDED" || (m.status === "PAID" && hadDispute)) {
      return sum + (amt * BigInt(100)) / BigInt(10000);
    }
    return sum;
  }, BigInt(0));

  const totalDisputeBuyerRefunds = escrow.milestones.reduce((sum, m) => {
    if (m.status === "RESOLVED") {
      if (m.buyerAward) return sum + BigInt(m.buyerAward);
      if (m.sellerAward) {
        const gross = BigInt(m.amount);
        const award = BigInt(m.sellerAward);
        const disputeFee = (gross * BigInt(100)) / BigInt(10000);
        const platformFee = (award * BigInt(250)) / BigInt(10000);
        const refund = gross - award - disputeFee - platformFee;
        return sum + (refund > BigInt(0) ? refund : BigInt(0));
      }
    }
    return sum;
  }, BigInt(0));

  const receiptRef = escrow.id.slice(2, 10).toUpperCase();

  return (
    <div className="min-h-screen bg-zinc-100 px-4 py-10 print:bg-white print:p-0">
      {/* Toolbar — hidden on print */}
      <div className="mx-auto mb-6 flex max-w-3xl items-center justify-between print:hidden">
        <button
          onClick={() => router.push(`/projects/${escrow.id}`)}
          className="text-sm text-zinc-600 hover:text-zinc-900 hover:underline"
        >
          ← Back to Project
        </button>
        <button
          onClick={() => window.print()}
          className="rounded-lg border border-zinc-400 bg-zinc-200 px-5 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-300"
        >
          Print / Save PDF
        </button>
      </div>

      {/* Receipt document */}
      <div className="mx-auto max-w-3xl border border-zinc-400 bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)] print:shadow-none print:border-zinc-400 [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">

        {/* Header */}
        <div className="border-b-2 border-zinc-400 bg-zinc-200 px-8 pt-6 pb-6 print:border-zinc-400 [print-color-adjust:exact]">
          {/* Branding */}
          <div className="mb-5 flex items-center gap-2.5 border-b border-zinc-300 pb-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg [print-color-adjust:exact]" style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.45)" }}>
              <Shield className="h-5 w-5 text-white" />
            </div>
            <span className="text-sm font-bold tracking-widest uppercase text-zinc-700">StablePay</span>
            <span className="ml-auto text-xs text-zinc-400 tracking-wide">On-chain escrow · Base (L2 Ethereum)</span>
          </div>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-black uppercase tracking-tight text-zinc-900">Payment Receipt</h1>
              <p className="mt-1 text-sm text-zinc-600">{escrow.title ? decodeTitle(escrow.title) : "Untitled Project"}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Reference</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-zinc-900">#{receiptRef}</p>
              <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">Date</p>
              <p className="mt-0.5 text-sm text-zinc-600">
                {new Date(escrow.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}
              </p>
            </div>
          </div>
        </div>

        {/* Parties */}
        <div className="grid grid-cols-2 border-b border-zinc-400">
          <div className="border-r border-zinc-400 px-8 py-5">
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">Buyer</p>
            <p className="text-base font-bold text-zinc-900">{buyerProfile?.companyName ?? "—"}</p>
            <p className="mt-1 break-all font-mono text-xs text-zinc-500">{escrow.buyer}</p>
          </div>
          <div className="px-8 py-5">
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">Seller</p>
            <p className="text-base font-bold text-zinc-900">{sellerProfile?.companyName ?? "—"}</p>
            <p className="mt-1 break-all font-mono text-xs text-zinc-500">{escrow.seller}</p>
          </div>
        </div>

        {/* Escrow details */}
        <div className="border-b border-zinc-400 px-8 py-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-1">
            <div>
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">Escrow Contract · </span>
              <span className="font-mono text-xs text-zinc-700">{escrow.id}</span>
            </div>
            <div className="flex gap-4">
              {escrow.txHash && (
                <a href={`${BASESCAN_URL}/tx/${escrow.txHash}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900">
                  Creation tx ↗
                </a>
              )}
              {escrow.fundedTxHash && (
                <a href={`${BASESCAN_URL}/tx/${escrow.fundedTxHash}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900">
                  Funding tx ↗
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Milestones table */}
        <div className="px-8 py-6">
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">Milestones</p>

          {/* Table header */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_90px] border border-zinc-400 bg-zinc-200">
            {["Description", "Escrowed", "Platform Fee", "Seller Received", "Status"].map((h) => (
              <div key={h} className="px-3 py-2">
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-600">{h}</p>
              </div>
            ))}
          </div>

          {/* Table rows */}
          {escrow.milestones.map((m) => {
            const gross = parseFloat(formatUnits(BigInt(m.amount), 6));
            const hadDispute = m.disputeOpenedAt != null;
            const isResolved = m.status === "RESOLVED";
            const isRefunded = m.status === "REFUNDED";
            const isDisputePaid = m.status === "PAID" && hadDispute;
            const isPaid = m.status === "PAID" || isResolved;
            const disputeFeeAmt = (isResolved || isRefunded || isDisputePaid) ? gross * 0.01 : 0;

            let net: number;
            let buyerRefund: number | null = null;
            let platformFeeDisplay: number;

            if (isResolved && m.sellerAward) {
              const awardBig = BigInt(m.sellerAward);
              const platformFeeBig = (awardBig * BigInt(250)) / BigInt(10000);
              net = parseFloat(formatUnits(awardBig - platformFeeBig, 6));
              platformFeeDisplay = parseFloat(formatUnits(awardBig, 6)) * 0.025;
              const buyerAwardVal = m.buyerAward
                ? parseFloat(formatUnits(BigInt(m.buyerAward), 6))
                : Math.max(0, gross - parseFloat(formatUnits(awardBig, 6)) - gross * 0.01);
              buyerRefund = buyerAwardVal > 0.001 ? buyerAwardVal : null;
            } else if (isDisputePaid && m.sellerAward) {
              const awardBig = BigInt(m.sellerAward);
              const platformFeeBig = (awardBig * BigInt(250)) / BigInt(10000);
              net = parseFloat(formatUnits(awardBig - platformFeeBig, 6));
              platformFeeDisplay = parseFloat(formatUnits(awardBig, 6)) * 0.025;
            } else if (isRefunded) {
              const buyerAwardVal = m.buyerAward
                ? parseFloat(formatUnits(BigInt(m.buyerAward), 6))
                : gross - gross * 0.01;
              buyerRefund = buyerAwardVal;
              platformFeeDisplay = 0;
              net = 0;
            } else {
              platformFeeDisplay = gross * 0.025;
              net = gross - platformFeeDisplay;
            }

            return (
              <div key={m.milestoneIndex}
                className="grid grid-cols-[2fr_1fr_1fr_1fr_90px] border-b border-l border-r border-zinc-400 print:break-inside-avoid">
                <div className="border-r border-zinc-200 px-3 py-3">
                  <p className="text-sm font-semibold text-zinc-900">Milestone {m.milestoneIndex + 1}</p>
                  {m.deliveryReference && (
                    <p className="mt-0.5 text-xs text-zinc-500 truncate max-w-[180px]">{m.deliveryReference}</p>
                  )}
                  {m.paidAt && (
                    <p className="mt-0.5 text-xs text-zinc-400">
                      {new Date(m.paidAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                  )}
                  {buyerRefund !== null && buyerRefund > 0.001 && (
                    <p className="mt-0.5 text-xs text-zinc-500">Buyer refunded: {buyerRefund.toFixed(2)} USDC</p>
                  )}
                </div>
                <div className="border-r border-zinc-200 px-3 py-3">
                  <p className="text-sm text-zinc-900">{gross.toFixed(2)}</p>
                  <p className="text-xs text-zinc-400">USDC</p>
                </div>
                <div className="border-r border-zinc-200 px-3 py-3">
                  {isPaid ? (
                    <>
                      <p className="text-sm text-zinc-900">{platformFeeDisplay.toFixed(2)} <span className="text-xs text-zinc-400">(2.5%)</span></p>
                      {(isResolved || isDisputePaid) && (
                        <p className="text-xs text-zinc-500">+ {disputeFeeAmt.toFixed(2)} dispute (1%)</p>
                      )}
                    </>
                  ) : isRefunded && disputeFeeAmt > 0 ? (
                    <p className="text-sm text-zinc-900">{disputeFeeAmt.toFixed(2)} <span className="text-xs text-zinc-400">dispute (1%)</span></p>
                  ) : (
                    <p className="text-sm text-zinc-400">—</p>
                  )}
                </div>
                <div className="border-r border-zinc-200 px-3 py-3">
                  {isPaid ? (
                    <>
                      <p className="text-sm font-bold text-zinc-900">{net.toFixed(2)}</p>
                      <p className="text-xs text-zinc-400">USDC</p>
                    </>
                  ) : (
                    <p className="text-sm text-zinc-400">—</p>
                  )}
                </div>
                <div className="px-3 py-3 flex items-start">
                  <span className={`inline-block rounded px-1.5 py-0.5 font-bold uppercase tracking-wide ${
                    isPaid ? "text-xs bg-white border border-zinc-900 text-zinc-900" :
                    m.status === "REFUNDED" ? "text-[10px] bg-white border border-zinc-400 text-zinc-500" :
                    "text-xs bg-white border border-zinc-300 text-zinc-500"
                  }`}>
                    {m.status === "RESOLVED" ? "PAID" : m.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary */}
        <div className="border-t-2 border-zinc-400 px-8 py-6 print:break-inside-avoid">
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">Summary</p>
          <div className="ml-auto max-w-xs space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-600">Total Escrowed</span>
              <span className="font-medium text-zinc-900">{parseFloat(formatUnits(totalEscrowed, 6)).toFixed(2)} USDC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600">Platform Fees (2.5%)</span>
              <span className="font-medium text-zinc-900">− {parseFloat(formatUnits(platformFees, 6)).toFixed(2)} USDC</span>
            </div>
            {totalDisputeFees > BigInt(0) && (
              <div className="flex justify-between">
                <span className="text-zinc-600">Dispute Fees (1%)</span>
                <span className="font-medium text-zinc-900">− {parseFloat(formatUnits(totalDisputeFees, 6)).toFixed(2)} USDC</span>
              </div>
            )}
            {totalRefunded > BigInt(0) && (
              <div className="flex justify-between">
                <span className="text-zinc-600">Refunded to Buyer</span>
                <span className="font-medium text-zinc-900">{parseFloat(formatUnits(totalRefunded, 6)).toFixed(2)} USDC</span>
              </div>
            )}
            {totalDisputeBuyerRefunds > BigInt(0) && (
              <div className="flex justify-between">
                <span className="text-zinc-600">Dispute Refunds to Buyer</span>
                <span className="font-medium text-zinc-900">{parseFloat(formatUnits(totalDisputeBuyerRefunds, 6)).toFixed(2)} USDC</span>
              </div>
            )}
            <div className="flex justify-between border-t-2 border-zinc-400 pt-3">
              <span className="text-base font-black uppercase tracking-wide text-zinc-900">Total Paid to Seller</span>
              <span className="text-base font-black text-zinc-900">{parseFloat(formatUnits(totalToSeller, 6)).toFixed(2)} USDC</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-200 bg-zinc-50 px-8 py-4">
          <p className="text-xs text-zinc-400">
            This receipt is generated by StablePay — on-chain escrow on Base (L2 Ethereum).
            All transactions are verifiable on Basescan. Document generated {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}.
          </p>
        </div>
      </div>
    </div>
  );
}
