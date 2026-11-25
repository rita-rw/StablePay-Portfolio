import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeMetadataHash } from "../src/utils/metadataHash";
import { sanitize, parseAddress } from "../src/utils/sanitize";

describe("computeMetadataHash", () => {
  it("is deterministic", () => {
    const a = computeMetadataHash("Logo design", "Three concepts", ["Sketches", "Final logo"]);
    const b = computeMetadataHash("Logo design", "Three concepts", ["Sketches", "Final logo"]);
    assert.equal(a, b);
  });

  it("keeps fields apart — moving text from title to description changes the hash", () => {
    assert.notEqual(computeMetadataHash("ab", "c", []), computeMetadataHash("a", "bc", []));
  });

  it("changes when a milestone label changes", () => {
    assert.notEqual(
      computeMetadataHash("Logo", "", ["Sketches"]),
      computeMetadataHash("Logo", "", ["Sketches!"]),
    );
  });
});

describe("sanitize", () => {
  it("removes HTML tags and keeps the text", () => {
    assert.equal(sanitize("<b>Final</b> delivery"), "Final delivery");
  });

  it("drops script tags together with their content", () => {
    assert.equal(sanitize("<script>alert(1)</script>hello"), "hello");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(sanitize("  hello  "), "hello");
  });

  it("keeps <, > and & as plain text instead of HTML entities", () => {
    assert.equal(sanitize("Step 1 -> step 2, x < y & z"), "Step 1 -> step 2, x < y & z");
    assert.equal(sanitize("R&D AB"), "R&D AB");
  });
});

describe("parseAddress", () => {
  it("returns the checksummed form of a valid address", () => {
    assert.equal(
      parseAddress("0x51f0011be8abcc57b9948c03c84f28068564a77d"),
      "0x51f0011Be8Abcc57b9948C03c84f28068564a77d",
    );
  });

  it("rejects malformed input", () => {
    assert.equal(parseAddress("0x123"), null);
    assert.equal(parseAddress("not an address"), null);
    assert.equal(parseAddress(42), null);
    assert.equal(parseAddress(undefined), null);
  });
});
