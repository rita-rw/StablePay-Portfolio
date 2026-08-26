import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const faqs = [
  {
    category: "Security & Funds",
    items: [
      {
        q: "Is my money safe? Who holds the funds?",
        a: "Funds are locked in a smart contract on Base L2 — not held by StablePay or any bank. They can only be released by buyer approval, auto-approval timeout, or StablePay arbitration if a dispute is escalated.",
      },
      {
        q: "Can StablePay take my money?",
        a: "No. StablePay can only intervene as an arbitrator in an escalated dispute, and only to split funds fairly between buyer and seller based on delivered work. We cannot withdraw funds to ourselves.",
      },
      {
        q: "What happens if the smart contract has a bug?",
        a: "The contract is deployed on Base L2 and verifiable on-chain. We strongly recommend both parties verify the contract address before funding any escrow.",
      },
    ],
  },
  {
    category: "Payments & Fees",
    items: [
      {
        q: "What does it cost?",
        a: "StablePay charges a 2.5% platform fee, deducted automatically when a milestone is approved. There are no setup fees, subscriptions, or hidden costs. If a dispute is escalated to StablePay arbitration, an additional 1% fee applies (total 3.5%).",
      },
      {
        q: "What currencies are supported?",
        a: "StablePay currently supports USDC on Base L2. USDC is a regulated stablecoin pegged 1:1 to the US dollar — no price volatility, instant settlement, sub-cent transaction fees.",
      },
      {
        q: "Do I need a bank account or credit card?",
        a: "No. You only need a wallet (e.g. MetaMask) and USDC on Base L2. Buyers fund projects with USDC; sellers receive USDC directly to their wallet.",
      },
    ],
  },
  {
    category: "Projects & Milestones",
    items: [
      {
        q: "What happens if the buyer never approves a milestone?",
        a: "If a buyer goes silent, the seller can trigger an auto-approval after the approval window expires. Funds are then released automatically by the smart contract — no platform intervention needed.",
      },
      {
        q: "Can a seller reject a project?",
        a: "Yes. After a buyer creates a project, the seller must accept the terms before any funds are locked. If the seller rejects, the project is cancelled and no funds are moved.",
      },
      {
        q: "What happens in a dispute?",
        a: "The seller has a 7-day correction window to fix rejected work. If unresolved, either party can escalate to StablePay. The platform reviews evidence from both sides and splits funds fairly. A 1% arbitration fee applies.",
      },
    ],
  },
  {
    category: "Getting Started",
    items: [
      {
        q: "Do both parties need to register?",
        a: "Yes. Both buyer and seller register their company name and details before using the platform. This ensures both parties are identifiable and accountable throughout the contract.",
      },
      {
        q: "What wallet do I need?",
        a: "Any wallet that supports Base L2 works — MetaMask, Coinbase Wallet, and others. We recommend connecting via the wallet button at the top of the page.",
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <div className="theme-app min-h-screen bg-white">
      <div className="container py-16 max-w-3xl mx-auto">

        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-900 transition-colors mb-10"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        <div className="mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-4">FAQ</p>
          <h1 className="text-4xl lg:text-5xl font-bold tracking-tight text-zinc-900">Common questions.</h1>
          <p className="mt-4 text-zinc-500 text-sm leading-relaxed max-w-lg">
            Everything you need to know about StablePay. Can't find the answer? Reach out to us directly.
          </p>
        </div>

        <div className="space-y-12">
          {faqs.map((section) => (
            <div key={section.category}>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-4">
                {section.category}
              </h2>
              <div className="divide-y divide-zinc-200 border-t border-zinc-200">
                {section.items.map(({ q, a }) => (
                  <div key={q} className="grid md:grid-cols-2 gap-4 py-7">
                    <h3 className="text-sm font-semibold text-zinc-900">{q}</h3>
                    <p className="text-sm text-zinc-600 leading-relaxed">{a}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>


      </div>
    </div>
  );
}
