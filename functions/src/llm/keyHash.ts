import * as crypto from "crypto";

/** Stable short hash for identifying saved API keys without exposing raw key material. */
export function keyHash(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex").slice(0, 16);
}
