import { after, type NextRequest } from 'next/server';
import { parseAdAttribution } from '@/lib/meta-ads-attribution';
import { createLead } from '@/lib/database';
import { withAccount } from '@/lib/tenant-context';
import { runAutomationsAfterEvent } from '@/lib/automations';
import { consumeRateLimit } from '@/lib/request-security';
import { WebsiteError } from '@/lib/website/model';
import { readWebsiteBody, websiteResponse, websiteFailure } from '@/lib/website/auth';
import { getPublicWebsite } from '@/lib/website/server';
import { assertPublicWebsiteHost } from '@/lib/website/domains-routing';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    await assertPublicWebsiteHost(request.headers, slug);
    const body = await readWebsiteBody(request, 8192);
    if (!await consumeRateLimit(request, 'website-inquiry', 8, 3600)) throw new WebsiteError('Muitas solicitações. Tente novamente mais tarde.', 429);
    if (Object.keys(body).some(k => !['name','phone','email','propertyId','details','attribution'].includes(k))) throw new WebsiteError('Confira os dados enviados.');
    for (const [key, limit] of Object.entries({ name: 120, phone: 30, email: 160, propertyId: 150, details: 1000 })) {
      if (body[key] !== undefined && (typeof body[key] !== 'string' || (body[key] as string).length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body[key] as string))) throw new WebsiteError('Confira os campos e os limites do formulário.');
    }
    let attribution;
    try { attribution = parseAdAttribution(body.attribution); } catch { throw new WebsiteError('A origem do contato possui dados inválidos.'); }
    const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max ? v.trim() : '';
    const name = text(body.name, 120), phone = text(body.phone, 30), email = text(body.email, 160), details = text(body.details, 1000);
    if (!name || !/^[+()\d\s-]{8,30}$/.test(phone) || !/^\d{8,15}$/.test(phone.replace(/\D/g, '')) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new WebsiteError('Informe seu nome, telefone e um email válido, se desejar.');
    const site = await getPublicWebsite(slug); if (!site) throw new WebsiteError('Este site não está disponível para receber contatos.', 404);
    const property = site.properties.find(p => p.id === body.propertyId); if (!property) throw new WebsiteError('Este imóvel não está mais disponível. Confira o catálogo atualizado.', 409);
    const account = { companyId: site.company.id, company: site.company.name, brokerId: 'system', name: 'Site da imobiliária', role: 'owner' as const };
    await withAccount(account, () => createLead({ name, phone, email: email || null, goal: property.purpose === 'Venda' ? 'Comprar' : 'Alugar', propertyType: property.propertyType || 'Imóvel', region: [property.district, property.city].filter(Boolean).join(', ') || 'A definir', budget: 'A definir', source: 'Site', details: `Interesse no imóvel ${property.code || property.id}: ${property.title}.${details ? ` ${details}` : ''}` }, attribution));
    after(() => withAccount(account, runAutomationsAfterEvent));
    return websiteResponse({ ok: true }, 201);
  } catch (error) { return websiteFailure(error); }
}
