import { describe, expect, it } from 'vitest';
import { assertSafeUrl, isBlockedIpAddress } from '../functions/src/handlers/extractTextFromUrl';

describe('extractTextFromUrl SSRF guard', () => {
  it('blocks private, loopback, link-local, and mapped private addresses', () => {
    expect(isBlockedIpAddress('127.0.0.1')).toBe(true);
    expect(isBlockedIpAddress('10.1.2.3')).toBe(true);
    expect(isBlockedIpAddress('172.16.0.1')).toBe(true);
    expect(isBlockedIpAddress('192.168.1.10')).toBe(true);
    expect(isBlockedIpAddress('169.254.169.254')).toBe(true);
    expect(isBlockedIpAddress('::1')).toBe(true);
    expect(isBlockedIpAddress('fc00::1')).toBe(true);
    expect(isBlockedIpAddress('fe80::1')).toBe(true);
    expect(isBlockedIpAddress('::ffff:10.0.0.1')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 in HEX form (the canonical form new URL emits)', () => {
    // `new URL("http://[::ffff:169.254.169.254]")` serializes the host to the hex
    // form below; a dotted-decimal-only guard misses it → metadata/loopback SSRF.
    expect(isBlockedIpAddress('::ffff:a9fe:a9fe')).toBe(true); // 169.254.169.254 metadata
    expect(isBlockedIpAddress('::ffff:7f00:1')).toBe(true);    // 127.0.0.1 loopback
    expect(isBlockedIpAddress('::ffff:a00:1')).toBe(true);     // 10.0.0.1 private
    expect(isBlockedIpAddress('::ffff:c0a8:1')).toBe(true);    // 192.168.0.1 private
  });

  it('rejects IPv4-mapped IPv6 metadata/loopback literals through assertSafeUrl', () => {
    expect(() => assertSafeUrl('http://[::ffff:169.254.169.254]/latest/meta-data')).toThrow();
    expect(() => assertSafeUrl('http://[::ffff:127.0.0.1]/')).toThrow();
  });

  it('allows ordinary public addresses', () => {
    expect(isBlockedIpAddress('8.8.8.8')).toBe(false);
    expect(isBlockedIpAddress('2606:4700:4700::1111')).toBe(false);
    expect(isBlockedIpAddress('::ffff:808:808')).toBe(false); // ::ffff:8.8.8.8 — public, still allowed
  });

  it('rejects unsafe URL schemes, hostnames, and non-default ports', () => {
    expect(() => assertSafeUrl('file:///etc/passwd')).toThrow();
    expect(() => assertSafeUrl('http://localhost/profile')).toThrow();
    expect(() => assertSafeUrl('http://metadata.google.internal/latest')).toThrow();
    expect(() => assertSafeUrl('https://example.com:8443/resume')).toThrow();
    expect(() => assertSafeUrl('http://example.com:8080/resume')).toThrow();
  });

  it('accepts default-port public http/https URLs', () => {
    expect(assertSafeUrl('https://example.com/resume').hostname).toBe('example.com');
    expect(assertSafeUrl('https://example.com:443/resume').hostname).toBe('example.com');
    expect(assertSafeUrl('http://example.com:80/resume').hostname).toBe('example.com');
  });
});
