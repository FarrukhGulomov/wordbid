import dns from 'node:dns';
import { Agent, fetch as undiciFetch } from 'undici';

/**
 * SSRF-safe outbound fetch.
 *
 * `validateDestinationUrl` rejects a hostname that IS a private/internal address, but a public
 * hostname can still resolve to one — "DNS rebinding" — and validating the hostname text alone
 * does not catch that. This module checks every IP address a lookup actually returns, at the
 * moment the connection is made, not before it. That closes the time-of-check/time-of-use gap:
 * the address that gets validated is the exact address undici then connects to.
 *
 * This deliberately calls `fetch` from the `undici` package, NOT the global `fetch` Node.js
 * provides built in. The two are backed by different, independently-versioned copies of undici —
 * Node's global fetch runs on whatever undici ships inside that Node release, unrelated to the
 * `undici` version in package.json. A `dispatcher`/`Agent` built from the npm package is not
 * guaranteed binary-compatible with Node's own internal copy: on this project's pinned undici
 * (8.10.2) against Node 22's bundled version, handing that Agent to the global fetch made EVERY
 * outbound request throw immediately — before DNS, before any connection — with
 * `InvalidArgumentError: invalid onRequestStart method`. This was indistinguishable from a real
 * network failure once wrapped in fetch's generic "fetch failed", and is the actual reason no
 * owner ever got a fetched description, regardless of the destination site. Using the fetch that
 * ships with the same `Agent` implementation keeps both sides on one consistent internal API.
 *
 * Use `safeFetch` for any request driven by a user-supplied URL that runs on the server.
 */

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // Malformed — refuse rather than guess.
  }
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

export function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 — unwrap and check the embedded v4 address.
    const mapped = lower.slice(7);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(mapped)) return isPrivateIPv4(mapped);
  }
  return (
    lower.startsWith('fe80:') || // link-local
    lower.startsWith('fc') || // unique local
    lower.startsWith('fd') || // unique local
    lower.startsWith('ff') // multicast
  );
}

function isPrivateIp(address: string, family: number): boolean {
  return family === 6 ? isPrivateIPv6(address) : isPrivateIPv4(address);
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/**
 * Custom DNS lookup used by the dispatcher below. Resolves normally, then throws if every
 * candidate — or the single candidate in non-`all` mode — is a private/internal address, so
 * undici never opens a socket to one.
 */
const safeLookup = ((hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, [] as unknown as string, undefined);
      return;
    }
    const list = addresses as dns.LookupAddress[];
    const safe = list.filter((a) => !isPrivateIp(a.address, a.family));

    if (safe.length === 0) {
      callback(
        new Error(`Refusing to connect: ${hostname} has no public address`),
        [] as unknown as string,
        undefined,
      );
      return;
    }

    if (options?.all) {
      callback(null, safe);
    } else {
      callback(null, safe[0]!.address, safe[0]!.family);
    }
  });
}) as unknown as typeof dns.lookup;

/** One dispatcher, reused across requests — building it per call would be wasteful. */
const safeDispatcher = new Agent({
  connect: { lookup: safeLookup },
});

/**
 * Fetches a user-supplied URL with SSRF protection.
 *
 * Callers must still validate the URL text first (scheme, credentials, obvious local
 * hostnames) with `validateDestinationUrl` — this only guards the DNS-to-socket step.
 */
export function safeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const undiciInit = { ...init, dispatcher: safeDispatcher } as unknown as Parameters<typeof undiciFetch>[1];
  return undiciFetch(url, undiciInit) as unknown as Promise<Response>;
}
