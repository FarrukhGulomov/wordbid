import dns from 'node:dns';
import { Agent } from 'undici';

/**
 * SSRF-safe outbound fetch.
 *
 * `validateDestinationUrl` rejects a hostname that IS a private/internal address, but a public
 * hostname can still resolve to one — "DNS rebinding" — and validating the hostname text alone
 * does not catch that. This module checks every IP address a lookup actually returns, at the
 * moment the connection is made, not before it. That closes the time-of-check/time-of-use gap:
 * the address that gets validated is the exact address undici then connects to.
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
  return fetch(url, { ...init, dispatcher: safeDispatcher } as RequestInit);
}
