import nodemailer from "nodemailer";
import { getAddress } from "viem";
import { prisma } from "./prisma";

export type NotificationEvent =
  | "PROJECT_ASSIGNED"
  | "PROJECT_ACCEPTED"
  | "PROJECT_REJECTED"
  | "PROJECT_CANCELLED"
  | "PROJECT_FUNDED"
  | "MILESTONE_SUBMITTED"
  | "MILESTONE_RESUBMITTED"
  | "DISPUTE_OPENED"
  | "DISPUTE_ESCALATED"
  | "MILESTONE_APPROVED"
  | "DISPUTE_RESOLVED";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

function subject(event: NotificationEvent, escrowAddress: string): string {
  const short = `${escrowAddress.slice(0, 6)}…${escrowAddress.slice(-4)}`;
  const map: Record<NotificationEvent, string> = {
    PROJECT_ASSIGNED:    `[StablePay] You have been assigned a new project (${short})`,
    PROJECT_ACCEPTED:    `[StablePay] Seller accepted — you can fund the project (${short})`,
    PROJECT_REJECTED:    `[StablePay] Seller declined the project (${short})`,
    PROJECT_CANCELLED:   `[StablePay] Project cancelled by the buyer (${short})`,
    PROJECT_FUNDED:      `[StablePay] Project funded — you can start work (${short})`,
    MILESTONE_SUBMITTED: `[StablePay] A milestone has been submitted for review (${short})`,
    MILESTONE_RESUBMITTED: `[StablePay] A milestone has been resubmitted for review (${short})`,
    DISPUTE_OPENED:      `[StablePay] A dispute has been opened (${short})`,
    DISPUTE_ESCALATED:   `[StablePay] Dispute escalated — admin action required (${short})`,
    MILESTONE_APPROVED:  `[StablePay] Milestone approved — payment released (${short})`,
    DISPUTE_RESOLVED:    `[StablePay] Dispute resolved by admin (${short})`,
  };
  return map[event];
}

function body(event: NotificationEvent, escrowAddress: string): string {
  const url = `${process.env.FRONTEND_URL ?? "http://localhost:3000"}/projects/${escrowAddress}`;
  const map: Record<NotificationEvent, string> = {
    PROJECT_ASSIGNED:    `You have been assigned as seller on a new StablePay project.\n\nView project: ${url}`,
    PROJECT_ACCEPTED:    `The seller has accepted your project. Please log in to fund the escrow so work can begin.\n\nView project: ${url}`,
    PROJECT_REJECTED:    `The seller has declined your project. No funds were locked.\n\nView project: ${url}`,
    PROJECT_CANCELLED:   `The buyer has cancelled the project. Any funds not yet released have been returned to the buyer.\n\nView project: ${url}`,
    PROJECT_FUNDED:      `The escrow has been funded by the buyer. You may now begin work on the project.\n\nView project: ${url}`,
    MILESTONE_SUBMITTED: `The seller has submitted a milestone for your review. Please log in to approve or open a dispute.\n\nView project: ${url}`,
    MILESTONE_RESUBMITTED: `The seller has resubmitted a milestone after your dispute. Please log in to review the new delivery.\n\nView project: ${url}`,
    DISPUTE_OPENED:      `A dispute has been opened on your project. Please log in to respond.\n\nView project: ${url}`,
    DISPUTE_ESCALATED:   `A dispute has been escalated and requires admin intervention.\n\nView project: ${url}`,
    MILESTONE_APPROVED:  `A milestone has been approved and payment has been released to you.\n\nView project: ${url}`,
    DISPUTE_RESOLVED:    `An admin has resolved a dispute on your project. Please log in to view the outcome.\n\nView project: ${url}`,
  };
  return map[event];
}

async function sendMail(to: string[], event: NotificationEvent, escrowAddress: string): Promise<void> {
  if (to.length === 0) return;
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER;
  try {
    await transport.sendMail({
      from,
      to: to.join(", "),
      subject: subject(event, escrowAddress),
      text: body(event, escrowAddress),
    });
    console.log(`[mailer] sent ${event} to ${to.join(", ")}`);
  } catch (err) {
    // Never crash the listener on mail failure
    console.error(`[mailer] failed to send ${event}`, err);
  }
}

/**
 * Send email notifications for a contract event.
 * Silently skips if a party has not registered (no User row).
 */
export async function sendNotification(event: NotificationEvent, escrowAddress: string): Promise<void> {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    // SMTP not configured — skip silently in dev
    return;
  }

  let buyer: string | null = null;
  let seller: string | null = null;

  try {
    const escrow = await prisma.escrow.findUnique({
      where: { id: escrowAddress },
      select: { buyer: true, seller: true },
    });
    if (!escrow) return;
    buyer = escrow.buyer;
    seller = escrow.seller;
  } catch (err) {
    console.error("[mailer] failed to look up escrow", err);
    return;
  }

  // Look up registered emails — missing users are simply ignored
  async function email(address: string): Promise<string | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { address: getAddress(address) },
        select: { email: true },
      });
      return user?.email ?? null;
    } catch {
      return null;
    }
  }

  const [buyerEmail, sellerEmail] = await Promise.all([email(buyer), email(seller)]);

  const recipients: Record<NotificationEvent, string[]> = {
    PROJECT_ASSIGNED:    [sellerEmail].filter(Boolean) as string[],
    PROJECT_ACCEPTED:    [buyerEmail].filter(Boolean) as string[],
    PROJECT_REJECTED:    [buyerEmail].filter(Boolean) as string[],
    PROJECT_CANCELLED:   [sellerEmail].filter(Boolean) as string[],
    PROJECT_FUNDED:      [sellerEmail].filter(Boolean) as string[],
    MILESTONE_SUBMITTED: [buyerEmail].filter(Boolean) as string[],
    MILESTONE_RESUBMITTED: [buyerEmail].filter(Boolean) as string[],
    DISPUTE_OPENED:      [...[buyerEmail, sellerEmail].filter(Boolean) as string[], ...(ADMIN_EMAIL ? [ADMIN_EMAIL] : [])],
    DISPUTE_ESCALATED:   ADMIN_EMAIL ? [ADMIN_EMAIL] : [],
    MILESTONE_APPROVED:  [sellerEmail].filter(Boolean) as string[],
    DISPUTE_RESOLVED:    [...[buyerEmail, sellerEmail].filter(Boolean) as string[]],
  };

  await sendMail(recipients[event], event, escrowAddress);
}
