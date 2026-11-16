import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { requireAuth, optionalAuth, requirePlatform, type AuthRequest } from "../src/auth";
import { mockResponse, mockNext } from "./helpers";

// Anvil's first default key — public test key, never holds real funds
const signer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
// Anvil's second default key
const otherSigner = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

function authMessage(opts: { chainId?: number; address?: string; ts?: number } = {}) {
  const chainId = opts.chainId ?? baseSepolia.id;
  const address = opts.address ?? signer.address;
  const ts = opts.ts ?? Date.now();
  return `StablePay auth | chain:${chainId} | address:${address} | ts:${ts}`;
}

async function signedRequest(message: string, signedBy = signer, claimed = signer.address) {
  const signature = await signedBy.signMessage({ message });
  return {
    headers: { "x-wallet-address": claimed, "x-signature": signature, "x-message": message },
  } as unknown as AuthRequest;
}

describe("requireAuth", () => {
  it("accepts a fresh signature from the claimed wallet", async () => {
    const req = await signedRequest(authMessage());
    const res = mockResponse();
    const next = mockNext();

    await requireAuth(req, res, next);

    assert.equal(next.calls, 1);
    assert.equal(req.signerAddress, signer.address);
  });

  it("rejects a request without auth headers", async () => {
    const req = { headers: {} } as AuthRequest;
    const res = mockResponse();
    const next = mockNext();

    await requireAuth(req, res, next);

    assert.equal(res.statusCode, 401);
    assert.equal(next.calls, 0);
  });

  it("rejects a signature made by a different wallet", async () => {
    const req = await signedRequest(authMessage(), otherSigner);
    const res = mockResponse();
    const next = mockNext();

    await requireAuth(req, res, next);

    assert.equal(res.statusCode, 401);
    assert.equal(next.calls, 0);
  });

  it("rejects a message older than 4 minutes (replay protection)", async () => {
    const req = await signedRequest(authMessage({ ts: Date.now() - 5 * 60 * 1000 }));
    const res = mockResponse();
    const next = mockNext();

    await requireAuth(req, res, next);

    assert.equal(res.statusCode, 401);
    assert.equal(next.calls, 0);
  });

  it("rejects a timestamp in the future", async () => {
    const req = await signedRequest(authMessage({ ts: Date.now() + 60 * 1000 }));
    const res = mockResponse();
    const next = mockNext();

    await requireAuth(req, res, next);

    assert.equal(res.statusCode, 401);
  });

  it("rejects a message signed for another chain", async () => {
    const req = await signedRequest(authMessage({ chainId: 1 }));
    const res = mockResponse();
    const next = mockNext();

    await requireAuth(req, res, next);

    assert.equal(res.statusCode, 401);
  });

  it("rejects when the address in the message differs from the header", async () => {
    // otherSigner signs a message naming itself, but the header claims to be signer
    const req = await signedRequest(authMessage({ address: otherSigner.address }), otherSigner, signer.address);
    const res = mockResponse();
    const next = mockNext();

    await requireAuth(req, res, next);

    assert.equal(res.statusCode, 401);
  });
});

describe("optionalAuth", () => {
  it("sets signerAddress for a valid signature", async () => {
    const req = await signedRequest(authMessage());
    const next = mockNext();

    await optionalAuth(req, mockResponse(), next);

    assert.equal(next.calls, 1);
    assert.equal(req.signerAddress, signer.address);
  });

  it("continues without signerAddress for an invalid signature", async () => {
    const req = await signedRequest(authMessage(), otherSigner);
    const res = mockResponse();
    const next = mockNext();

    await optionalAuth(req, res, next);

    assert.equal(next.calls, 1);
    assert.equal(req.signerAddress, undefined);
    assert.equal(res.statusCode, 200);
  });
});

describe("requirePlatform", () => {
  const original = process.env.PLATFORM_ADDRESS;
  afterEach(() => {
    process.env.PLATFORM_ADDRESS = original;
  });

  it("lets the platform wallet through (case-insensitive)", () => {
    process.env.PLATFORM_ADDRESS = signer.address.toLowerCase();
    const req = { signerAddress: signer.address } as AuthRequest;
    const next = mockNext();

    requirePlatform(req, mockResponse(), next);

    assert.equal(next.calls, 1);
  });

  it("returns 403 for any other wallet", () => {
    process.env.PLATFORM_ADDRESS = signer.address;
    const req = { signerAddress: otherSigner.address } as AuthRequest;
    const res = mockResponse();
    const next = mockNext();

    requirePlatform(req, res, next);

    assert.equal(res.statusCode, 403);
    assert.equal(next.calls, 0);
  });

  it("returns 500 when PLATFORM_ADDRESS is not configured", () => {
    delete process.env.PLATFORM_ADDRESS;
    const req = { signerAddress: signer.address } as AuthRequest;
    const res = mockResponse();

    requirePlatform(req, res, mockNext());

    assert.equal(res.statusCode, 500);
  });
});
