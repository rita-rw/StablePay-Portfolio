import type { Response } from "express";
import type { AuthRequest } from "../auth";
import { sanitize, parseAddress } from "../utils/sanitize";
import { findUser, createUser, updateUser, findPublicUserProfile, findPrivateUserProfile } from "../services/userService";
import { hasSharedEscrow } from "../services/escrowService";

export async function registerUser(req: AuthRequest, res: Response): Promise<void> {
  const { address, companyName, orgNumber, email } = req.body;

  if (req.signerAddress?.toLowerCase() !== address.toLowerCase()) {
    res.status(403).json({ error: "Forbidden: signer must match address" });
    return;
  }

  const normalizedAddress = parseAddress(address);
  if (!normalizedAddress) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }

  try {
    const existing = await findUser(normalizedAddress);
    if (existing) {
      res.status(409).json({ error: "User already registered" });
      return;
    }

    const user = await createUser({
      address: normalizedAddress,
      companyName: sanitize(companyName),
      orgNumber: sanitize(orgNumber),
      email: sanitize(email),
      termsAcceptedAt: new Date(),
      paymentTermsAcceptedAt: new Date(),
    });

    res.json({ address: user.address, companyName: user.companyName });
  } catch (err) {
    console.error("[API] POST /users/register failed", err);
    res.status(500).json({ error: "Failed to register user" });
  }
}

export async function updateUserProfile(req: AuthRequest, res: Response): Promise<void> {
  const parsedAddr = parseAddress(req.params.address as string);
  if (!parsedAddr) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }

  if (req.signerAddress?.toLowerCase() !== parsedAddr.toLowerCase()) {
    res.status(403).json({ error: "Forbidden: signer must match address" });
    return;
  }

  const { companyName, orgNumber, email } = req.body;

  try {
    const user = await updateUser(parsedAddr, {
      companyName: sanitize(companyName),
      orgNumber: sanitize(orgNumber),
      email: sanitize(email),
    });
    res.json({
      address: user.address,
      companyName: user.companyName,
      orgNumber: user.orgNumber,
      email: user.email,
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error("[API] PUT /users/:address failed", err);
    res.status(500).json({ error: "Failed to update user" });
  }
}

export async function getUser(req: AuthRequest, res: Response): Promise<void> {
  const parsedAddr = parseAddress(req.params.address as string);
  if (!parsedAddr) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }

  try {
    const caller = req.signerAddress;
    const isSelf = caller?.toLowerCase() === parsedAddr.toLowerCase();
    const isSharedEscrow = !isSelf && caller ? await hasSharedEscrow(caller, parsedAddr) : false;
    const canViewPrivate = isSelf || isSharedEscrow;

    const user = canViewPrivate
      ? await findPrivateUserProfile(parsedAddr)
      : await findPublicUserProfile(parsedAddr);

    if (!user) {
      // Not an error: the frontend polls this on every page load to check whether
      // a connected wallet is registered. "No profile" is a normal answer, so
      // return 200 + null rather than a 404 the browser console logs in red.
      res.json(null);
      return;
    }
    res.json(user);
  } catch (err) {
    console.error("[API] GET /users/:address failed", err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
}
