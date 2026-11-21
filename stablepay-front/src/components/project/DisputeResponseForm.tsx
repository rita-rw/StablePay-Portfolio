import { dayLabel } from "@/lib/formatters";

type DisputeResponseFormProps = {
  correctionWindowDays: number;
  /** The seller's response already saved, if any. */
  savedResponse?: string | null;
  open: boolean;
  onOpen: () => void;
  onCancel: () => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  saving: boolean;
  onSave: () => void;
  error?: string;
};

/** After the correction window: the seller can no longer resubmit, but can give their side (no tx). */
export function DisputeResponseForm({
  correctionWindowDays,
  savedResponse,
  open,
  onOpen,
  onCancel,
  draft,
  onDraftChange,
  saving,
  onSave,
  error,
}: DisputeResponseFormProps) {
  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-zinc-700">
        {correctionWindowDays > 0 && `The ${dayLabel(correctionWindowDays)} correction window has ended, so you can no longer resubmit. `}
        The platform will review and resolve this dispute.
      </p>
      {!open ? (
        <button
          onClick={onOpen}
          className="w-full rounded-lg border border-zinc-400 px-4 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
        >
          {savedResponse ? "Edit your response" : "Respond to the dispute"}
        </button>
      ) : (
        <div className="rounded-lg border border-zinc-400 bg-white p-3 space-y-2">
          <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Your response to the platform</p>
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder="Give your side of the dispute…"
            maxLength={500}
            rows={3}
            className="w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={!draft.trim() || saving}
              className="flex-1 rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-900 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Send to Platform"}
            </button>
          </div>
        </div>
      )}
      <p className="text-xs text-zinc-500">No transaction needed. Your response is shown to the platform and the buyer.</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
