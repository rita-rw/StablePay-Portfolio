import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DeliveryBody,
  EscalationBody,
  MetadataBody,
  ResolutionNoteBody,
} from "../src/validators/projectSchemas";
import { MAX_DELIVERY_REF, MIN_RESOLUTION_NOTE } from "../src/utils/constants";

describe("DeliveryBody", () => {
  it("accepts a normal delivery reference", () => {
    assert.equal(DeliveryBody.safeParse({ deliveryReference: "https://figma.com/file/abc" }).success, true);
  });

  it("rejects an empty or missing reference", () => {
    assert.equal(DeliveryBody.safeParse({ deliveryReference: "" }).success, false);
    assert.equal(DeliveryBody.safeParse({}).success, false);
  });

  it("rejects text over the max length", () => {
    const tooLong = "x".repeat(MAX_DELIVERY_REF + 1);
    assert.equal(DeliveryBody.safeParse({ deliveryReference: tooLong }).success, false);
  });
});

describe("EscalationBody", () => {
  it("does not trim — the text must stay identical to what was hashed on-chain", () => {
    const result = EscalationBody.safeParse({ escalationReason: "  Buyer stopped responding  " });
    assert.equal(result.success, true);
    assert.equal(result.data?.escalationReason, "  Buyer stopped responding  ");
  });
});

describe("ResolutionNoteBody", () => {
  it("requires a real explanation, counted after trimming", () => {
    const padded = " ".repeat(20) + "x".repeat(MIN_RESOLUTION_NOTE - 1);
    assert.equal(ResolutionNoteBody.safeParse({ resolutionNote: padded }).success, false);
  });

  it("accepts a note of sufficient length", () => {
    const note = "Seller delivered 3 of 5 screens; split 60/40.";
    assert.equal(ResolutionNoteBody.safeParse({ resolutionNote: note }).success, true);
  });
});

describe("MetadataBody", () => {
  const valid = { title: "Logo design", metadataHash: "0x" + "ab".repeat(32) };

  it("accepts a title and a bytes32 hash", () => {
    assert.equal(MetadataBody.safeParse(valid).success, true);
  });

  it("rejects a hash that is not bytes32", () => {
    assert.equal(MetadataBody.safeParse({ ...valid, metadataHash: "0x1234" }).success, false);
  });

  it("rejects a blank title", () => {
    assert.equal(MetadataBody.safeParse({ ...valid, title: "   " }).success, false);
  });
});
