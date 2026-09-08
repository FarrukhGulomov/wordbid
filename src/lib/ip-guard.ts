/**
 * Pure IPv4/IPv6 "is this a private/internal address" checks, with no side effects — used both
 * by safe-fetch.ts (checked against whatever DNS actually returns, at connection time) and
 * url.ts (checked against a literal IP address typed directly into the destination URL, before
 * any DNS lookup happens at all). Kept in one place so the two never drift apart, which is
 * exactly how F03 happened: url.ts had its own separate regex blocklist for IPv6 literals that
 * covered fewer forms than this module's checks, so a literal IPv6 address could slip past
 * validateDestinationUrl's text check by being written in a form the regex didn't anticipate,
 * even though safeFetch's own DNS-time check (for a HOSTNAME resolving to that same address)
 * would have caught it.
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

/**
 * Expands ANY textual IPv6 literal — compressed ("::"), fully written out, with a trailing
 * embedded IPv4 dotted-quad ("::ffff:127.0.0.1"), bracketed ("[::1]"), or carrying a zone id
 * ("fe80::1%eth0") — into its 8 sixteen-bit groups. Returns null for anything that doesn't
 * actually parse as IPv6, so callers can treat "couldn't understand this" as private/refused
 * rather than silently letting it through.
 */
function expandIPv6(input: string): number[] | null {
  let addr = input.trim().toLowerCase();
  if (addr.startsWith('[') && addr.endsWith(']')) addr = addr.slice(1, -1);
  const zoneIndex = addr.indexOf('%');
  if (zoneIndex !== -1) addr = addr.slice(0, zoneIndex);
  if (!addr) return null;

  // An embedded IPv4 dotted-quad can only ever be the final segment — fold it into two hex
  // groups up front so the rest of this function only ever deals with plain hex groups.
  const lastColon = addr.lastIndexOf(':');
  const tail = addr.slice(lastColon + 1);
  if (tail.includes('.')) {
    const octets = tail.split('.').map(Number);
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const [o0, o1, o2, o3] = octets as [number, number, number, number];
    const hi = ((o0 << 8) | o1).toString(16);
    const lo = ((o2 << 8) | o3).toString(16);
    addr = `${addr.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = addr.split('::');
  if (halves.length > 2) return null; // "::" can appear at most once.

  const parseGroups = (segment: string): number[] | null => {
    if (segment === '') return [];
    const groups = segment.split(':');
    const nums: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      nums.push(parseInt(g, 16));
    }
    return nums;
  };

  if (halves.length === 1) {
    const groups = parseGroups(halves[0]!);
    return groups && groups.length === 8 ? groups : null;
  }

  const left = parseGroups(halves[0]!);
  const right = parseGroups(halves[1]!);
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  return [...left, ...new Array(missing).fill(0), ...right];
}

export function isPrivateIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g) return true; // Malformed — refuse rather than guess.

  if (g.every((x) => x === 0)) return true; // :: (unspecified)
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0 && g[6] === 0 && g[7] === 1) {
    return true; // ::1 (loopback)
  }

  // IPv4-mapped, ::ffff:0:0/96 — in ANY textual form (dotted-quad tail already folded into the
  // last two groups by expandIPv6, or written as plain hex to begin with). Unwrap and re-check
  // against the embedded v4 address rather than trusting the wrapper.
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    const v4 = `${(g[6]! >> 8) & 0xff}.${g[6]! & 0xff}.${(g[7]! >> 8) & 0xff}.${g[7]! & 0xff}`;
    return isPrivateIPv4(v4);
  }

  if (g[0]! >= 0xfe80 && g[0]! <= 0xfebf) return true; // fe80::/10 link-local
  if (g[0]! >= 0xfc00 && g[0]! <= 0xfdff) return true; // fc00::/7 unique local
  if (g[0]! >= 0xff00 && g[0]! <= 0xffff) return true; // ff00::/8 multicast

  return false;
}
