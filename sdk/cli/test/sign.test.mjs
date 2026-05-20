import assert from "node:assert/strict";
import test from "node:test";

import { parseSignerIndex } from "../dist/commands/sign.js";

test("parseSignerIndex accepts only signer indexes 0 through 4", () => {
  assert.equal(parseSignerIndex("0"), 0);
  assert.equal(parseSignerIndex("4"), 4);
  assert.equal(parseSignerIndex(" 2 "), 2);
});

test("parseSignerIndex rejects malformed values", () => {
  assert.equal(parseSignerIndex(""), null);
  assert.equal(parseSignerIndex("NaN"), null);
  assert.equal(parseSignerIndex("5"), null);
  assert.equal(parseSignerIndex("-1"), null);
  assert.equal(parseSignerIndex("1.5"), null);
  assert.equal(parseSignerIndex("1abc"), null);
});
