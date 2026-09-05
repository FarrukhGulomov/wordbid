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

  it('allows ordinary public IPv6 addresses', () => {
    expect(isPrivateIPv6('2001:4860:4860::8888')).toBe(false);
  });
});
