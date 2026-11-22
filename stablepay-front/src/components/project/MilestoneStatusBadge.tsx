import { milestoneStatusBadge } from "@/lib/formatters";

type MilestoneStatusBadgeProps = {
  status: string;
  hadDispute: boolean;
  /** A tx has confirmed and the page is waiting for the backend to catch up. */
  processing: boolean;
};

/** Status pill in the milestone header, or a spinner while the backend syncs. */
export function MilestoneStatusBadge({ status, hadDispute, processing }: MilestoneStatusBadgeProps) {
  if (processing) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 border border-orange-200 px-3 py-1 text-xs font-medium text-orange-600">
        <svg className="h-3 w-3 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Processing...
      </span>
    );
  }

  const badge = milestoneStatusBadge(status, hadDispute);
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badge.color}`}>
      {badge.label}
    </span>
  );
}
