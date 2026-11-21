import { GrowingTextarea } from "@/components/shared/GrowingTextarea";
import { parseContractError } from "@/lib/formatters";
import { txButtonLabel, type TxAction } from "@/lib/tx";

type DeliveryFormProps = {
  /** Optional line above the field, e.g. the correction window for a resubmit. */
  intro?: string;
  placeholder: string;
  buttonLabel: string;
  value: string;
  onChange: (value: string) => void;
  send: TxAction;
  /** The same tx is in flight on another milestone. */
  busyElsewhere: boolean;
  /** The tx went through but the backend could not save the text. */
  saveError?: string;
};

const PRIMARY_BUTTON_STYLE = {
  background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)",
  boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)",
};

/** Seller's delivery field and button — used for the first submit and for a resubmit during a dispute. */
export function DeliveryForm({
  intro,
  placeholder,
  buttonLabel,
  value,
  onChange,
  send,
  busyElsewhere,
  saveError,
}: DeliveryFormProps) {
  const sending = send.isPending || send.isConfirming;

  return (
    <div className="mt-3 space-y-2">
      {intro && <p className="text-xs text-zinc-700">{intro}</p>}
      <GrowingTextarea
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={500}
        disabled={sending}
        className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
      />
      <button
        onClick={send.onClick}
        disabled={!value.trim() || sending || busyElsewhere}
        className="w-full rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
        style={PRIMARY_BUTTON_STYLE}
      >
        {txButtonLabel(send, buttonLabel)}
      </button>
      {send.error && <p className="text-xs text-red-500">{parseContractError(send.error)}</p>}
      {saveError && <p className="text-xs text-red-500">{saveError}</p>}
    </div>
  );
}
