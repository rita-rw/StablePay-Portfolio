import Link from "next/link";

type ProjectNoticesProps = {
  isBuyer: boolean;
  isSeller: boolean;
  hasAccepted: boolean;
  hasFunded: boolean;
  isClosed: boolean;
  /** The seller is invited but has no company registered yet. */
  needsRegistration: boolean;
  projectId: string;
};

/** What the user is waiting for before the escrow is funded. */
export function ProjectNotices({
  isBuyer,
  isSeller,
  hasAccepted,
  hasFunded,
  isClosed,
  needsRegistration,
  projectId,
}: ProjectNoticesProps) {
  if (isClosed || hasFunded) return null;

  if (isSeller && !hasAccepted && needsRegistration) {
    return (
      <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
        <h2 className="mb-2 text-lg font-semibold">Registration Required</h2>
        <p className="mb-4 text-sm text-zinc-800">
          You have been invited to this project. To accept or reject, you must first register your company on StablePay.
        </p>
        <Link
          href={`/register?redirect=/projects/${projectId}`}
          className="inline-block rounded-lg bg-primary px-5 py-2 text-sm text-white transition-colors hover:brightness-110"
        >
          Register Company
        </Link>
      </div>
    );
  }

  const waitingText =
    isBuyer && !hasAccepted
      ? "Waiting for the seller to accept this project before you can fund it."
      : isSeller && hasAccepted
        ? "You accepted this project. Waiting for the buyer to fund the escrow before you can start work."
        : null;
  if (!waitingText) return null;

  return (
    <div className="mb-6 rounded-lg border border-orange-200 bg-orange-50 p-4">
      <p className="text-sm text-orange-700">{waitingText}</p>
    </div>
  );
}
