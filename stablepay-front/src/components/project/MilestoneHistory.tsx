import { formatDate, shortAddr } from "@/lib/formatters";
import { MilestonePayment } from "@/components/project/MilestonePayment";

type MilestoneHistoryProps = {
  milestone: {
    amount: string;
    disputeOpenedAt?: string | null;
    disputeEscalatedAt?: string | null;
    paidAt?: string | null;
    resolutionNote?: string | null;
    autoApproved?: boolean | null;
  };
  /** Milestone status as shown on the page (after local overrides). */
  status: string;
  /** Status the milestone is waiting to reach after a confirmed tx, if any. */
  processingAs?: string;
  locallyPaid: boolean;
  locallyDisputed: boolean;
  /** Texts from the backend, or the local copy until the backend has them. */
  deliveryText?: string | null;
  disputeReason?: string | null;
  disputeOpenedBy?: string | null;
  disputeOpenedAt?: string | null;
  sellerResponse?: string | null;
  escalationReason?: string | null;
  sellerAward?: string | null;
  buyer?: string;
  buyerCompany?: string | null;
  sellerCompany?: string | null;
};

/** Read-only record of what happened to a milestone: delivery, dispute, escalation, approval, payment. */
export function MilestoneHistory({
  milestone: m,
  status,
  processingAs,
  locallyPaid,
  locallyDisputed,
  deliveryText,
  disputeReason,
  disputeOpenedBy,
  disputeOpenedAt,
  sellerResponse,
  escalationReason,
  sellerAward,
  buyer,
  buyerCompany,
  sellerCompany,
}: MilestoneHistoryProps) {
  const hadDispute = !!m.disputeOpenedAt;
  const isDisputeOutcome =
    status === "RESOLVED" || ((status === "PAID" || status === "REFUNDED") && hadDispute);
  const showDisputeBox =
    (status === "DISPUTED" || isDisputeOutcome || locallyDisputed) &&
    (processingAs == null || processingAs === "DISPUTED");
  // sellerEscalate overwrites disputeOpenedBy with the seller on-chain, but only a
  // buyer-opened dispute can be escalated — so an escalated dispute was opened by the buyer.
  const openedBy = m.disputeEscalatedAt ? buyer : disputeOpenedBy;
  const isByBuyer = openedBy?.toLowerCase() === buyer?.toLowerCase();

  return (
    <>
      {deliveryText && (
        <div className="mt-3 rounded-lg border border-zinc-900 bg-zinc-50 p-3 text-xs">
          <p className="mb-1 font-semibold text-zinc-500 uppercase tracking-wider text-[10px]">Seller delivery message</p>
          <p className="whitespace-pre-wrap break-words text-zinc-800">{deliveryText}</p>
        </div>
      )}
      {(status === "ESCALATED" || processingAs === "ESCALATED") && (
        <div className="mt-3 border-l-2 border-red-500 bg-zinc-50 px-3 py-2 text-xs rounded-r-md space-y-1">
          <p className="mb-1.5 font-semibold text-red-600 uppercase tracking-wider text-[10px]">Escalated</p>
          <p className="text-zinc-700">
            <span className="font-medium text-zinc-600">Buyer opened dispute:</span>{" "}
            {buyerCompany ?? (buyer ? shortAddr(buyer) : "Buyer")}
            {m.disputeOpenedAt && <span className="text-zinc-400"> · {formatDate(m.disputeOpenedAt)}</span>}
          </p>
          {disputeReason && (
            <p className="text-zinc-800">
              <span className="font-medium text-zinc-600">Dispute reason:</span> {disputeReason}
            </p>
          )}
          <p className="text-zinc-700">
            <span className="font-medium text-zinc-600">Seller escalated to admin</span>
            {m.disputeEscalatedAt && <span className="text-zinc-400"> · {formatDate(m.disputeEscalatedAt)}</span>}
          </p>
          {escalationReason && (
            <p className="text-zinc-800">
              <span className="font-medium text-zinc-600">Escalation reason:</span> {escalationReason}
            </p>
          )}
          <p className="text-zinc-500 italic">The platform is reviewing and will resolve this dispute.</p>
        </div>
      )}
      {showDisputeBox && (
        <div className="mt-3 border-l-2 border-red-500 bg-zinc-50 px-3 py-2 text-xs rounded-r-md">
          <p className="mb-1.5 font-semibold text-red-600 uppercase tracking-wider text-[10px]">Dispute</p>
          {openedBy && (
            <p className="mb-1 text-zinc-700">
              <span className="font-medium text-zinc-600">Opened by ({isByBuyer ? "Buyer" : "Seller"}):</span>{" "}
              {(isByBuyer ? buyerCompany : sellerCompany) ?? shortAddr(openedBy)}
            </p>
          )}
          {disputeReason && (
            <p className="mb-1 text-zinc-800">
              <span className="font-medium text-zinc-600">Reason:</span> {disputeReason}
            </p>
          )}
          {sellerResponse && (
            <p className="mb-1 whitespace-pre-wrap break-words text-zinc-800">
              <span className="font-medium text-zinc-600">Seller&apos;s response:</span> {sellerResponse}
            </p>
          )}
          {disputeOpenedAt && (
            <p className="text-zinc-700">
              <span className="font-medium text-zinc-600">Opened:</span>{" "}
              {formatDate(disputeOpenedAt)}
            </p>
          )}
          {isDisputeOutcome && m.paidAt && (
            <p className="mt-1 text-zinc-700">
              <span className="font-medium text-zinc-600">Settled:</span>{" "}
              {formatDate(m.paidAt)}
            </p>
          )}
          {isDisputeOutcome && m.resolutionNote && (
            <p className="mt-1 whitespace-pre-wrap break-words text-zinc-800">
              <span className="font-medium text-zinc-600">Decision by StablePay:</span> {m.resolutionNote}
            </p>
          )}
        </div>
      )}
      {status === "PAID" && !hadDispute && (locallyPaid || processingAs == null) && (
        <div className="mt-3 border-l-2 border-blue-500 bg-zinc-50 px-3 py-2 text-xs rounded-r-md">
          <p className="font-semibold text-zinc-500 uppercase tracking-wider text-[10px] mb-1">Approval</p>
          <p className="text-zinc-800">
            {m.autoApproved === true
              ? "Auto-approved. The seller claimed the payment after the approval window ended."
              : m.autoApproved === false
                ? "Approved by the buyer. Payment released to the seller."
                : "Payment released to the seller."}
          </p>
        </div>
      )}
      {["PAID", "REFUNDED", "RESOLVED"].includes(status) && (
        <MilestonePayment amount={m.amount} status={status} hadDispute={hadDispute} sellerAward={sellerAward} />
      )}
    </>
  );
}
