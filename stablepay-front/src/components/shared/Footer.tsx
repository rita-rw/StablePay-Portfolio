import { FACTORY_ADDRESS, BASESCAN_URL } from "@/lib/constants";

export default function Footer() {
  return (
    <footer className="border-t border-zinc-200 print:hidden">
      <div className="w-full px-8 h-12 flex items-center justify-center">
        <a
          href={`${BASESCAN_URL}/address/${FACTORY_ADDRESS}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-zinc-900 underline underline-offset-2 hover:text-zinc-700"
        >
          View and verify on the blockchain ↗
        </a>
      </div>
    </footer>
  );
}
