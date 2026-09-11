import { protectedRoute } from '@/lib/accounts';
import { after, NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { deleteProperty, updateProperty } from '@/lib/database';
import type { PropertyInput } from '@/lib/operations';
import { persistPropertyImages } from '@/lib/property-images';
import { hasSameOrigin } from '@/lib/request-security';

import { onPropertyChanged } from '@/lib/opportunities';
import { supabaseCompanyId } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 60;

function clean(value: unknown, max = 300) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanImages(value: unknown) {
  if (!Array.isArray(value)) return [];
  const images = value.filter((image): image is string => typeof image === 'string' && (/^data:image\/(jpeg|png|webp);base64,/.test(image) || /^https:\/\//.test(image)) && image.length <= 700_000).slice(0, 5);
  return images.reduce<string[]>((accepted, image) => accepted.join('').length + image.length <= 3_200_000 ? [...accepted, image] : accepted, []);
}

async function handlePATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const number = (value: unknown) => value === '' || value == null ? undefined : Math.max(0, Number(value) || 0);
    const yes = (value: unknown) => value === true || value === 'yes';
    const input: PropertyInput = {
      code: clean(body.code, 60), title: clean(body.title, 160), description: clean(body.description, 1200), district: clean(body.district, 120), city: clean(body.city, 120), address: clean(body.address, 300), price: clean(body.price, 80), meta: clean(body.meta, 500),
      tone: clean(body.tone, 30) || 'orchid', purpose: body.purpose === 'Aluguel' ? 'Aluguel' : 'Venda', images: cleanImages(body.images),
      propertyType: clean(body.propertyType, 80), bedrooms: number(body.bedrooms), parkingSpaces: number(body.parkingSpaces), area: number(body.area), publicUrl: clean(body.publicUrl, 500),
      keyInOffice: yes(body.keyInOffice), occupied: yes(body.occupied), catalogedOnInstagram: yes(body.catalogedOnInstagram), catalogedOnSite: yes(body.catalogedOnSite),
      status: body.status === 'Reservado' ? 'Reservado' : body.status === 'Vendido' ? 'Vendido' : body.status === 'Alugado' ? 'Alugado' : 'Disponível',
    };
    if (!input.code || !input.title || !input.description || !input.district || !input.city || !input.price || !input.propertyType || input.bedrooms == null || input.parkingSpaces == null || input.area == null) return NextResponse.json({ error: 'Preencha os campos obrigatórios.' }, { status: 400 });
    input.images = await persistPropertyImages(input.images);
    const data = await updateProperty((await context.params).id, input);
    const companyId = supabaseCompanyId();
    if (data) after(() => onPropertyChanged(companyId, data.id));
    return data ? NextResponse.json({ data }) : NextResponse.json({ error: 'Imóvel não encontrado.' }, { status: 404 });
  } catch (error) {
    console.error('property_update_failed', error);
    return NextResponse.json({ error: 'Não foi possível atualizar o imóvel.' }, { status: 500 });
  }
}

async function handleDELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  try {
    return await deleteProperty((await context.params).id)
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: 'Imóvel não encontrado.' }, { status: 404 });
  } catch (error) {
    console.error('property_delete_failed', error);
    return NextResponse.json({ error: 'Não foi possível excluir o imóvel.' }, { status: 500 });
  }
}

export const PATCH = protectedRoute(handlePATCH);
export const DELETE = protectedRoute(handleDELETE);
