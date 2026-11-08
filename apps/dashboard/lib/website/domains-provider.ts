import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import { connect, checkServerIdentity } from 'node:tls';
import type { WebsiteDnsRecord, WebsiteDomainStatus } from './domains-model';

type ProviderConfig = { token: string; projectId: string; teamId?: string };
type ProjectDomain = { name?: string; apexName?: string; projectId?: string; verified?: boolean; redirect?: string | null; gitBranch?: string | null; customEnvironmentId?: string | null; verification?: Array<{ type?: string; domain?: string; value?: string }> };
type DomainConfiguration = { misconfigured?: boolean; configuredBy?: string | null; recommendedCNAME?: Array<{ rank: number; value: string }>; recommendedIPv4?: Array<{ rank: number; value: string[] }> };
export type DomainCheckResult = { status: WebsiteDomainStatus; ownershipVerified: boolean; providerVerified: boolean; dnsValid: boolean; tlsVerified: boolean; projectId: string | null; records: WebsiteDnsRecord[]; message: string };
export function domainProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig | null {
  const token = env.WEBSITE_VERCEL_TOKEN, projectId = env.WEBSITE_VERCEL_PROJECT_ID, teamId = env.WEBSITE_VERCEL_TEAM_ID;
  if (!token || !projectId || !/^prj_[A-Za-z0-9]+$/.test(projectId) || teamId && !/^team_[A-Za-z0-9]+$/.test(teamId)) return null;
  return { token, projectId, ...(teamId ? { teamId } : {}) };
}
export class DomainProviderFailure extends Error { constructor(public status: number) { super('domain_provider_failed'); } }
async function vercel<T>(config: ProviderConfig, path: string, method = 'GET', body?: unknown): Promise<T> {
  const url = new URL(`https://api.vercel.com${path}`);
  if (config.teamId) url.searchParams.set('teamId', config.teamId);
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new DomainProviderFailure(response.status);
  return response.json() as Promise<T>;
}

/** Reject non-public IPv4 before a pinned TLS connection; never fetch a user-supplied URL. */
export function publicDomainIPv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 88 && c === 99) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}
async function domainTxt(hostname: string): Promise<string[][]> { return new Resolver({ timeout: 2500, tries: 2 }).resolveTxt(hostname); }
async function domainTls(hostname: string): Promise<boolean> {
  const addresses = await new Resolver({ timeout: 2500, tries: 2 }).resolve4(hostname);
  if (!addresses.length || addresses.some(ip => !publicDomainIPv4(ip))) return false;
  return new Promise(resolve => {
    let finished = false;
    const socket = connect({ host: addresses[0], port: 443, servername: hostname, rejectUnauthorized: true, checkServerIdentity: (_host, cert) => checkServerIdentity(hostname, cert) });
    const complete = (value: boolean) => { if (!finished) { finished = true; socket.destroy(); resolve(value); } };
    socket.setTimeout(6000, () => complete(false));
    socket.once('error', () => complete(false));
    socket.once('secureConnect', () => { const cert = socket.getPeerCertificate(); complete(socket.authorized && Date.parse(cert.valid_from) <= Date.now() && Date.parse(cert.valid_to) > Date.now()); });
  });
}

export function providerDnsRecords(hostname: string, domain: ProjectDomain, configuration: DomainConfiguration): WebsiteDnsRecord[] {
  const records: WebsiteDnsRecord[] = [];
  for (const challenge of domain.verification || []) {
    if (challenge.type === 'TXT' && typeof challenge.domain === 'string' && /^[a-z0-9_.-]{1,253}$/i.test(challenge.domain) && typeof challenge.value === 'string' && challenge.value.length <= 1024 && !/[\u0000-\u001f]/.test(challenge.value)) records.push({ type: 'TXT', name: challenge.domain, value: challenge.value, purpose: 'provider' });
  }
  const cname = (configuration.recommendedCNAME || []).filter(item => typeof item.value === 'string' && /^[a-z0-9.-]+\.?$/i.test(item.value)).sort((a, b) => a.rank - b.rank)[0];
  const ips = (configuration.recommendedIPv4 || []).filter(item => Array.isArray(item.value)).sort((a, b) => a.rank - b.rank)[0]?.value.filter(publicDomainIPv4) || [];
  if (hostname !== domain.apexName && cname) records.push({ type: 'CNAME', name: hostname, value: cname.value, purpose: 'routing' });
  else for (const ip of ips) records.push({ type: 'A', name: hostname, value: ip, purpose: 'routing' });
  return records.slice(0, 16);
}

type CheckDependencies = { txt: typeof domainTxt; tls: typeof domainTls; provider: typeof vercel; config: ProviderConfig | null };
/** Provider APIs: /v10/projects/:id/domains; /v9/projects/:id/domains/:domain[/verify]; /v6/domains/:domain/config. */
export async function checkWebsiteDomain(hostname: string, token: string, dependencies: Partial<CheckDependencies> = {}): Promise<DomainCheckResult> {
  const deps: CheckDependencies = { txt: domainTxt, tls: domainTls, provider: vercel, config: domainProviderConfig(), ...dependencies };
  const result: DomainCheckResult = { status: 'pending', ownershipVerified: false, providerVerified: false, dnsValid: false, tlsVerified: false, projectId: null, records: [], message: 'O TXT de comprovação ainda não foi encontrado. Aguarde a propagação do DNS e verifique novamente.' };
  try {
    const records = await deps.txt(`_imobflow-domain.${hostname}`);
    if (!records.some(parts => parts.join('') === `imobflow-verification=${token}`)) return result;
    result.ownershipVerified = true; result.status = 'verified';
    if (!deps.config) return { ...result, message: 'Posse confirmada. A equipe ImobFlow precisa concluir a configuração de hospedagem para conectar o domínio.' };
    const config = deps.config;
    const path = `/v9/projects/${encodeURIComponent(config.projectId)}/domains/${encodeURIComponent(hostname)}`;
    let domain: ProjectDomain;
    try { domain = await deps.provider<ProjectDomain>(config, path); }
    catch (issue) {
      if (!(issue instanceof DomainProviderFailure) || issue.status !== 404) throw issue;
      domain = await deps.provider<ProjectDomain>(config, `/v10/projects/${encodeURIComponent(config.projectId)}/domains`, 'POST', { name: hostname });
    }
    if (domain.name !== hostname || typeof domain.apexName !== 'string' || domain.projectId !== config.projectId || domain.redirect || domain.gitBranch || domain.customEnvironmentId) return { ...result, status: 'error', message: 'O domínio possui uma configuração de hospedagem incompatível. A equipe ImobFlow precisa revisar o vínculo existente.' };
    result.projectId = domain.projectId; result.status = 'provisioning';
    if (!domain.verified) {
      try { domain = await deps.provider<ProjectDomain>(config, `${path}/verify`, 'POST'); }
      catch (issue) { if (!(issue instanceof DomainProviderFailure) || issue.status !== 400) throw issue; }
    }
    const configuration = await deps.provider<DomainConfiguration>(config, `/v6/domains/${encodeURIComponent(hostname)}/config?projectIdOrName=${encodeURIComponent(config.projectId)}`);
    result.records = providerDnsRecords(hostname, domain, configuration);
    result.providerVerified = domain.verified === true && domain.name === hostname && domain.projectId === config.projectId && !domain.redirect && !domain.gitBranch && !domain.customEnvironmentId;
    result.dnsValid = configuration.misconfigured === false && ['A', 'CNAME'].includes(configuration.configuredBy || '');
    if (!result.providerVerified) return { ...result, message: 'Adicione também a comprovação solicitada pela hospedagem e verifique novamente.' };
    if (!result.dnsValid) return { ...result, message: 'Configure os registros de direcionamento abaixo. Se usar proxy DNS, deixe este endereço em modo somente DNS.' };
    result.tlsVerified = await deps.tls(hostname);
    if (!result.tlsVerified) return { ...result, message: 'DNS confirmado. O certificado HTTPS ainda não está pronto; aguarde e verifique novamente.' };
    return { ...result, status: 'active', message: 'Domínio conectado: posse, direcionamento e certificado HTTPS confirmados.' };
  } catch (issue) {
    if (!result.ownershipVerified) return { ...result, message: 'Não foi possível confirmar o TXT agora. Confira o registro e tente novamente após a propagação.' };
    if (issue instanceof DomainProviderFailure && [401, 403].includes(issue.status)) return { ...result, status: 'verified', message: 'Posse confirmada. A autorização de hospedagem precisa ser revisada pela equipe ImobFlow.' };
    if (issue instanceof DomainProviderFailure && issue.status === 409) return { ...result, status: 'error', message: 'O domínio já está vinculado a outro projeto de hospedagem. Nenhum vínculo existente foi transferido.' };
    return { ...result, status: result.dnsValid ? 'provisioning' : 'error', message: 'Não foi possível concluir a verificação. O domínio permanece sem ativação; tente novamente em alguns minutos.' };
  }
}
