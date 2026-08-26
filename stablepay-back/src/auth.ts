import { verifyMessage, getAddress, isAddress } from "viem";
import type { Request, Response, NextFunction } from "express";

// Message must be no older than 4 minutes to prevent replay attacks
const MAX_AGE_MS = 4 * 60 * 1000;

const EXPECTED_CHAIN_ID = "84532"; // Base Sepolia

export interface AuthRequest extends Request {
  signerAddress?: string;
}

/**
 * Verifies that the request is signed by the claimed wallet address.
 * Requires headers:
 *   x-wallet-address  — the Ethereum address claiming to sign
 *   x-signature       — signature of x-message
 *   x-message         — must be "StablePay auth: {unixTimestampMs}"
 *
 * On success, attaches req.signerAddress (checksummed) and calls next().
 * On failure, returns 401.
 */
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const claimed = req.headers["x-wallet-address"] as string | undefined;
  const signature = req.headers["x-signature"] as string | undefined;
  const message = req.headers["x-message"] as string | undefined;

  if (!claimed || !signature || !message) {
    res.status(401).json({ error: "Missing auth headers (x-wallet-address, x-signature, x-message)" });
    return;
  }

  if (!isAddress(claimed)) {
    res.status(401).json({ error: "Invalid x-wallet-address" });
    return;
  }

  // Validate message format and timestamp freshness
  // New format: "StablePay auth | chain:{id} | address:{addr} | ts:{timestamp}"
  // Old format (backward compat, remove later): "StablePay auth: {timestamp}"
  const newMatch = message.match(/^StablePay auth \| chain:(\w+) \| address:(0x[0-9a-fA-F]+) \| ts:(\d+)$/);
  const oldMatch = !newMatch ? message.match(/^StablePay auth: (\d+)$/) : null;

  if (!newMatch && !oldMatch) {
    res.status(401).json({ error: "Invalid message format" });
    return;
  }

  let timestamp: number;

  if (newMatch) {
    const [, chainId, msgAddress, ts] = newMatch;
    if (chainId !== EXPECTED_CHAIN_ID) {
      res.status(401).json({ error: `Invalid chain ID. Expected ${EXPECTED_CHAIN_ID}` });
      return;
    }
    if (getAddress(msgAddress) !== getAddress(claimed)) {
      res.status(401).json({ error: "Message address does not match x-wallet-address" });
      return;
    }
    timestamp = parseInt(ts, 10);
  } else {
    timestamp = parseInt(oldMatch![1], 10);
  }

  const age = Date.now() - timestamp;
  if (age < 0 || age > MAX_AGE_MS) {
    res.status(401).json({ error: "Message expired. Re-sign with a fresh timestamp." });
    return;
  }

  try {
    const valid = await verifyMessage({
      address: getAddress(claimed),
      message,
      signature: signature as `0x${string}`,
    });

    if (!valid) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    req.signerAddress = getAddress(claimed);
    next();
  } catch {
    res.status(401).json({ error: "Signature verification failed" });
  }
}

/**
 * Like requireAuth but does not reject unauthenticated requests.
 * Sets req.signerAddress if valid headers are present, otherwise continues without it.
 */
export async function optionalAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const claimed = req.headers["x-wallet-address"] as string | undefined;
  const signature = req.headers["x-signature"] as string | undefined;
  const message = req.headers["x-message"] as string | undefined;

  if (!claimed || !signature || !message || !isAddress(claimed)) {
    next();
    return;
  }

  const newMatch = message.match(/^StablePay auth \| chain:(\w+) \| address:(0x[0-9a-fA-F]+) \| ts:(\d+)$/);
  const oldMatch = !newMatch ? message.match(/^StablePay auth: (\d+)$/) : null;

  if (!newMatch && !oldMatch) {
    next();
    return;
  }

  let timestamp: number;
  if (newMatch) {
    const [, chainId, msgAddress, ts] = newMatch;
    if (chainId !== EXPECTED_CHAIN_ID || getAddress(msgAddress) !== getAddress(claimed)) {
      next();
      return;
    }
    timestamp = parseInt(ts, 10);
  } else {
    timestamp = parseInt(oldMatch![1], 10);
  }

  const age = Date.now() - timestamp;
  if (age < 0 || age > MAX_AGE_MS) {
    next();
    return;
  }

  try {
    const valid = await verifyMessage({
      address: getAddress(claimed),
      message,
      signature: signature as `0x${string}`,
    });
    if (valid) {
      req.signerAddress = getAddress(claimed);
    }
  } catch {
    // Invalid signature — continue without auth
  }

  next();
}

/**
 * Checks that the signer is the platform address.
 * Must be used after requireAuth.
 */
export function requirePlatform(req: AuthRequest, res: Response, next: NextFunction): void {
  const platform = process.env.PLATFORM_ADDRESS;
  if (!platform) {
    res.status(500).json({ error: "PLATFORM_ADDRESS not configured" });
    return;
  }

  if (req.signerAddress?.toLowerCase() !== platform.toLowerCase()) {
    res.status(403).json({ error: "Forbidden: platform only" });
    return;
  }

  next();
}
