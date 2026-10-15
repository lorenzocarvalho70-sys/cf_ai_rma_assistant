import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkCode,
  generateCode,
  hashCode,
  sameHash,
  type CodeRow
} from "../src/codes.ts";

test("codes are 8 random digits", () => {
  const codes = new Set(Array.from({ length: 200 }, generateCode));
  for (const c of codes) assert.match(c, /^\d{8}$/);
  assert.ok(codes.size > 195, "codes should not repeat in a small sample");
});

test("hash depends on pepper, shipment and code, and ignores whitespace", async () => {
  const h = await hashCode("pepper", 12, "12345678");
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(await hashCode("pepper", 12, " 12345678 "), h);
  assert.notEqual(await hashCode("other", 12, "12345678"), h);
  assert.notEqual(await hashCode("pepper", 13, "12345678"), h);
  assert.notEqual(await hashCode("pepper", 12, "12345679"), h);
  assert.ok(sameHash(h, h));
  assert.ok(!sameHash(h, h.replace(/.$/, "x")));
});

const row = (over: Partial<CodeRow> = {}): CodeRow => ({
  code_hash: "aa",
  valid_from: "2026-10-16T09:00:00Z",
  valid_to: "2026-10-16T12:00:00Z",
  status: "issued",
  ...over
});
const inWindow = new Date("2026-10-16T10:00:00Z");

test("correct code inside the window is valid", () => {
  assert.deepEqual(checkCode(row(), "aa", inWindow), { valid: true });
});

test("wrong code or no code is invalid but not a violation", () => {
  assert.deepEqual(checkCode(row(), "bb", inWindow), {
    valid: false,
    reason: "Incorrect code.",
    violation: false
  });
  assert.equal(checkCode(undefined, "aa", inWindow).valid, false);
});

test("correct code that is revoked, reused, expired or outside the window is a violation", () => {
  const cases: [Partial<CodeRow>, Date, RegExp][] = [
    [{ status: "revoked" }, inWindow, /revoked/],
    [{ status: "used" }, inWindow, /already used/],
    [{ status: "expired" }, inWindow, /outside/],
    [{}, new Date("2026-10-16T08:59:00Z"), /outside/],
    [{}, new Date("2026-10-16T12:01:00Z"), /outside/]
  ];
  for (const [over, at, reason] of cases) {
    const r = checkCode(row(over), "aa", at);
    assert.equal(r.valid, false);
    if (!r.valid) {
      assert.equal(r.violation, true);
      assert.match(r.reason, reason);
    }
  }
});
