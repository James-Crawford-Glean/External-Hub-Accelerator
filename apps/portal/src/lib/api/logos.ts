// Domain -> logo URL via the project's logo cache (fetchLogos extracts +
// caches in S3 and returns the /logos/<sha> CDN URL; null on failure).

import { gql } from './graphql';

const FETCH_LOGOS_QUERY = `
  query Logos($domains: [String!]!) {
    fetchLogos(domains: $domains) {
      domain
      logoUrl
    }
  }
`;

interface DomainLogo {
  domain: string;
  logoUrl: string | null;
}

/** Resolve logo URLs for a set of domains. Returns domain -> url (null = none). */
export async function fetchLogos(domains: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(domains.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const data = await gql<{ fetchLogos: DomainLogo[] }>(FETCH_LOGOS_QUERY, { domains: unique });
  return new Map(data.fetchLogos.map((d) => [d.domain, d.logoUrl]));
}
