import { describe, expect, it } from 'vitest';
import { isPrivateIPv4, isPrivateIPv6 } from '@/lib/safe-fetch';

describe('isPrivateIPv4', () => {
  it('flags loopback, RFC1918, link-local and cloud metadata', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '169.254.169.254', // AWS/GCP/Azure metadata endpoint
      '0.0.0.0',
      '100.64.0.1', // CGNAT
      '198.18.0.1', // benchmarking
      '224.0.0.1', // multicast
    ]) {
      expect(isPrivateIPv4(ip), ip).toBe(true);
    }
  });

  it('allows ordinary public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1']) {
      expect(isPrivateIPv4(ip), ip).toBe(false);
    }
  });

  it('treats malformed input as private', () => {
    expect(isPrivateIPv4('not-an-ip')).toBe(true);
    expect(isPrivateIPv4('999.1.1.1')).toBe(true);
    expect(isPrivateIPv4('1.2.3')).toBe(true);
  });
});

describe('isPrivateIPv6', () => {
  it('flags loopback, unspecified, link-local and unique-local', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1']) {
      expect(isPrivateIPv6(ip), ip).toBe(true);
    }
  });

  it('unwraps IPv4-mapped addresses and checks the embedded address', () => {
    expect(isPrivateIPv6('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIPv6('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateIPv6('::ffff:8.8.8.8')).toBe(false);
  });

  // F03: dns.lookup can hand back an IPv4-mapped address as plain hex ("::ffff:7f00:1") rather
  // than the dotted-quad form ("::ffff:127.0.0.1") — which libc/OS-dependent form you get back
  // for the SAME address is not something callers control. The old implementation's unwrap only
  // matched a literal dotted-quad tail, so the hex form fell through every check and came back
  // "not private" — a real bypass, not just a theoretical one.
  it('unwraps IPv4-mapped addresses written in full hex, not just dotted-quad', () => {
    expect(isPrivateIPv6('::ffff:7f00:1')).toBe(true); // 127.0.0.1
    expect(isPrivateIPv6('::ffff:a9fe:a9fe')).toBe(true); // 169.254.169.254
    expect(isPrivateIPv6('::ffff:808:808')).toBe(false); // 8.8.8.8
  });

  it('unwraps a fully expanded (non-"::"-compressed) IPv4-mapped address', () => {
    expect(isPrivateIPv6('0:0:0:0:0:ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIPv6('0:0:0:0:0:ffff:7f00:1')).toBe(true);
  });

  it('handles brackets and a zone id', () => {
    expect(isPrivateIPv6('[fe80::1]')).toBe(true);
    expect(isPrivateIPv6('fe80::1%eth0')).toBe(true);
    expect(isPrivateIPv6('[fe80::1%eth0]')).toBe(true);
  });

  it('allows ordinary public IPv6 addresses', () => {
    expect(isPrivateIPv6('2001:4860:4860::8888')).toBe(false);
  });

  it('treats malformed IPv6 text as private', () => {
    expect(isPrivateIPv6('not-an-ipv6-address')).toBe(true);
    expect(isPrivateIPv6('::::')).toBe(true);
    expect(isPrivateIPv6('1:2:3:4:5:6:7:8:9')).toBe(true);
  });
});
