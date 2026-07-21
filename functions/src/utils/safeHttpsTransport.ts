import { lookup as dnsLookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";
import { HttpsError } from "firebase-functions/v2/https";

const MAX_RESPONSE_BYTES = 10_000_000;
const MAX_REDIRECT_HOPS = 5;

export interface SafeHttpsRequestInit {
  method: "POST" | "GET";
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface SafeHttpsResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

interface HopResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

type LookupAll = (
  hostname: string,
  options: { all: true; order: "verbatim" },
) => Promise<Array<{ address: string; family: number }>>;

type RequestHop = (
  url: URL,
  init: SafeHttpsRequestInit,
  pinnedAddress: ResolvedAddress,
) => Promise<HopResponse>;

export interface SafeHttpsTransportDependencies {
  lookup?: LookupAll;
  requestHop?: RequestHop;
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

function extractMappedIpv4(normalized: string): string | null {
  const dotted = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (dotted) return dotted;
  const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

/** Mirrors the URL-import SSRF ranges, including IPv4-mapped IPv6. */
export function isBlockedNetworkAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mappedV4 = extractMappedIpv4(normalized);
  if (mappedV4) return isBlockedNetworkAddress(mappedV4);

  if (isIP(normalized) === 4) {
    const octets = parseIpv4(normalized);
    if (!octets) return true;
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (isIP(normalized) === 6) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff")
    );
  }

  return true;
}

/** Validates an outbound provider URL before any DNS or network work. */
export function assertSafeHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpsError("invalid-argument", "Invalid URL.");
  }
  if (url.protocol !== "https:") {
    throw new HttpsError("invalid-argument", "URL must use https.");
  }
  if (url.port && url.port !== "443") {
    throw new HttpsError("invalid-argument", "URL must use the default https port.");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const blocked =
    host === "localhost" ||
    host === "metadata.google.internal" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (isIP(host) !== 0 && isBlockedNetworkAddress(host));
  if (blocked) {
    throw new HttpsError("invalid-argument", "This URL host is not allowed.");
  }
  return url;
}

/** Resolves and checks every DNS answer; mixed public/private answers fail closed. */
export async function resolveSafeAddresses(
  hostname: string,
  lookup: LookupAll = dnsLookup,
): Promise<ResolvedAddress[]> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const literalFamily = isIP(host);
  if (literalFamily !== 0) {
    if (isBlockedNetworkAddress(host)) {
      throw new HttpsError("invalid-argument", "This URL host is not allowed.");
    }
    return [{ address: host, family: literalFamily as 4 | 6 }];
  }

  const results = await lookup(host, { all: true, order: "verbatim" });
  if (!results.length) {
    throw new HttpsError("failed-precondition", "Couldn't resolve that URL host.");
  }
  for (const result of results) {
    if ((result.family !== 4 && result.family !== 6) || isBlockedNetworkAddress(result.address)) {
      throw new HttpsError(
        "invalid-argument",
        "This URL host resolves to a blocked network address.",
      );
    }
  }
  return results.map((result) => ({
    address: result.address,
    family: result.family as 4 | 6,
  }));
}

function requestPinnedHttps(
  url: URL,
  init: SafeHttpsRequestInit,
  pinnedAddress: ResolvedAddress,
): Promise<HopResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const req = https.request(
      url,
      {
        method: init.method,
        headers: init.headers,
        timeout: init.timeoutMs,
        agent: false,
        lookup: (_hostname, options, callback) => {
          if (options.all) {
            callback(null, [pinnedAddress]);
            return;
          }
          callback(null, pinnedAddress.address, pinnedAddress.family);
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          settled = true;
          resolve({ status, headers: res.headers, body: "" });
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer | string) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buf.length;
          if (total > MAX_RESPONSE_BYTES) {
            res.destroy(new Error("response too large"));
            return;
          }
          chunks.push(buf);
        });
        res.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({
            status,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", fail);
      },
    );

    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", fail);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

function toResponse(response: HopResponse): SafeHttpsResponse {
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    text: async () => response.body,
    json: async () => JSON.parse(response.body) as unknown,
  };
}

function removeHeaders(headers: Record<string, string>, names: string[]): Record<string, string> {
  const blocked = new Set(names.map((name) => name.toLowerCase()));
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !blocked.has(name.toLowerCase())),
  );
}

function redirectRequest(
  currentUrl: URL,
  nextUrl: URL,
  status: number,
  init: SafeHttpsRequestInit,
): SafeHttpsRequestInit {
  let headers = { ...init.headers };
  if (currentUrl.origin !== nextUrl.origin) {
    headers = removeHeaders(headers, ["authorization", "cookie", "proxy-authorization"]);
  }

  if (status === 303 || ((status === 301 || status === 302) && init.method === "POST")) {
    headers = removeHeaders(headers, ["content-length", "content-type"]);
    return { ...init, method: "GET", headers, body: undefined };
  }
  return { ...init, headers };
}

export function createSafeHttpsTransport(
  dependencies: SafeHttpsTransportDependencies = {},
): (url: string, init: SafeHttpsRequestInit) => Promise<SafeHttpsResponse> {
  const lookup = dependencies.lookup ?? dnsLookup;
  const requestHop = dependencies.requestHop ?? requestPinnedHttps;

  return async (rawUrl, init) => {
    let target = assertSafeHttpsUrl(rawUrl);
    let currentInit = init;
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const addresses = await resolveSafeAddresses(target.hostname, lookup);
      const response = await requestHop(target, currentInit, addresses[0]);
      if (response.status >= 300 && response.status < 400) {
        const location = Array.isArray(response.headers.location)
          ? response.headers.location[0]
          : response.headers.location;
        if (!location) return toResponse(response);
        const nextTarget = assertSafeHttpsUrl(new URL(location, target).toString());
        currentInit = redirectRequest(target, nextTarget, response.status, currentInit);
        target = nextTarget;
        continue;
      }
      return toResponse(response);
    }
    throw new Error("too many redirects");
  };
}

export const safeHttpsRequest = createSafeHttpsTransport();
