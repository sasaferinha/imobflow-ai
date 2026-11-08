export type WebsiteDomainStatus = 'pending' | 'verified' | 'provisioning' | 'active' | 'error';
export type WebsiteDnsRecord = { type: 'TXT' | 'CNAME' | 'A'; name: string; value: string; purpose: 'ownership' | 'provider' | 'routing' };
export type WebsiteDomain = { id: string; hostname: string; status: WebsiteDomainStatus; version: number; disabled: boolean; checkedAt: string | null; ownershipVerifiedAt: string | null; tlsVerifiedAt: string | null; message: string; records: WebsiteDnsRecord[] };
export type WebsiteDomainsSnapshot = { domains: WebsiteDomain[]; providerConfigured: boolean };
