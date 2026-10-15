// One-time site entry codes (spec section 6). Only the hash is ever stored.

const CODE_DIGITS = 8;
const CODE_SPACE = 10 ** CODE_DIGITS;
// Largest multiple of CODE_SPACE below 2^32, so `value % CODE_SPACE` is unbiased.
const UNBIASED_LIMIT = Math.floor(2 ** 32 / CODE_SPACE) * CODE_SPACE;

export function generateCode(): string {
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= UNBIASED_LIMIT);
  return String(buf[0] % CODE_SPACE).padStart(CODE_DIGITS, "0");
}

/**
 * SHA-256 of pepper + shipment + code. The pepper is a Wrangler secret, so a
 * leaked database alone isn't enough to brute-force the 8-digit space.
 */
export async function hashCode(
  pepper: string,
  shipmentId: number,
  code: string
): Promise<string> {
  const data = new TextEncoder().encode(
    `${pepper}:${shipmentId}:${code.trim()}`
  );
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Compares two hex digests without short-circuiting on the first difference. */
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type CodeRow = {
  code_hash: string;
  valid_from: string;
  valid_to: string;
  status: "issued" | "used" | "expired" | "revoked";
};

export type CodeCheck =
  | { valid: true }
  | { valid: false; reason: string; violation: boolean };

/**
 * Decides whether a presented code opens the gate. A wrong code is just
 * invalid; a correct code presented when it shouldn't work (revoked, reused,
 * outside the window) is an access violation worth an exception.
 */
export function checkCode(
  row: CodeRow | undefined,
  presentedHash: string,
  now: Date
): CodeCheck {
  if (!row)
    return {
      valid: false,
      reason: "No entry code issued for this shipment.",
      violation: false
    };
  if (!sameHash(row.code_hash, presentedHash)) {
    return { valid: false, reason: "Incorrect code.", violation: false };
  }
  if (row.status === "revoked") {
    return { valid: false, reason: "Code was revoked.", violation: true };
  }
  if (row.status === "used") {
    return { valid: false, reason: "Code was already used.", violation: true };
  }
  const t = now.getTime();
  if (
    row.status === "expired" ||
    t < new Date(row.valid_from).getTime() ||
    t > new Date(row.valid_to).getTime()
  ) {
    return {
      valid: false,
      reason: "Code used outside its delivery window.",
      violation: true
    };
  }
  return { valid: true };
}
