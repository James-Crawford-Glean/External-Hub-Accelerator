import { host, websiteHost, normalizeDomain, urlPathKey } from './index';

describe('host', () => {
  it('strips scheme, path, query, fragment and lowercases; keeps www.', () => {
    expect(host('https://www.360insights.com/foo?a=1#x')).toBe('www.360insights.com');
    expect(host('HTTPS://WWW.Acme.COM')).toBe('www.acme.com');
  });
  it('handles malformed colon-less and protocol-relative schemes', () => {
    expect(host('https//www.x.com')).toBe('www.x.com');
    expect(host('//x.com')).toBe('x.com');
  });
  it('does not eat a bare host, and trims trailing dots', () => {
    expect(host('www.x.com')).toBe('www.x.com');
    expect(host('x.com...')).toBe('x.com');
  });
  it('returns empty for nullish/empty', () => {
    expect(host(null)).toBe('');
    expect(host(undefined)).toBe('');
    expect(host('')).toBe('');
  });
});

describe('websiteHost', () => {
  it('keeps www. (display host)', () => {
    expect(websiteHost('https://www.360insights.com/')).toBe('www.360insights.com');
    expect(websiteHost('acme.com')).toBe('acme.com');
  });
  it('is empty for nullish', () => {
    expect(websiteHost(null)).toBe('');
  });
});

describe('normalizeDomain', () => {
  it('strips the www. prefix', () => {
    expect(normalizeDomain('https://www.360insights.com/')).toBe('360insights.com');
    expect(normalizeDomain('WWW.Acme.com')).toBe('acme.com');
  });
  it('leaves a non-www host intact', () => {
    expect(normalizeDomain('acme.com')).toBe('acme.com');
    expect(normalizeDomain('//sub.acme.com')).toBe('sub.acme.com');
  });
  it('returns empty for nullish', () => {
    expect(normalizeDomain(null)).toBe('');
    expect(normalizeDomain('')).toBe('');
  });
});

describe('urlPathKey', () => {
  it('keeps the path so a regional sub-site differs from the global site', () => {
    expect(urlPathKey('https://www.accenture.com/nz-en/')).toBe('accenture.com/nz-en');
    expect(urlPathKey('www.accenture.com')).toBe('accenture.com');
  });
  it('strips scheme, www., query, fragment, trailing slash; lowercases', () => {
    expect(urlPathKey('HTTPS://WWW.Acme.com/US-EN/?x=1#f')).toBe('acme.com/us-en');
    expect(urlPathKey('acme.com/')).toBe('acme.com');
  });
  it('returns empty for nullish', () => {
    expect(urlPathKey(null)).toBe('');
    expect(urlPathKey('')).toBe('');
  });
});
