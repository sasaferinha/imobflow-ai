import { after, NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { createProperty, listProperties } from '@/lib/database';
import type { PropertyInput } from '@/lib/operations';

import { runAutomationsAfterEvent } from '@/lib/automations';

export const runtime = 'nodejs';
export const maxDuration = 60;

function clean(value: unknown, max = 300) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanImages(value: unknown) {
  if (!Array.isArray(value)) return [];
  const images = value.filter((image): image is string => typeof image === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(image) && image.length <= 700_000).slice(0, 5);
  return images.reduce<string[]>((accepted, image) => accepted.join('').length + image.length <= 3_200_000 ? [...accepted, image] : accepted, []);
}

function propertyInput(body: Record<string, unknown>): PropertyInput {
  const number = (value: unknown) => value === '' || value == null ? undefined : Math.max(0, Number(value) || 0);
  return {
    code: clean(body.code, 60), title: clean(body.title, 160), description: clean(body.description, 1200),
    district: clean(body.district, 120), city: clean(body.city, 120), address: clean(body.address, 300), price: clean(body.price, 80),
    meta: clean(body.meta, 500), match: Math.max(0, Math.min(100, Number(body.match) || 80)),
    tone: clean(body.tone, 30) || 'orchid', purpose: body.purpose === 'Aluguel' ? 'Aluguel' : 'Venda', images: cleanImages(body.images),
    propertyType: clean(body.propertyType, 80), bedrooms: number(body.bedrooms), parkingSpaces: number(body.parkingSpaces), area: number(body.area), publicUrl: clean(body.publicUrl, 500),
    status: body.status === 'Reservado' ? 'Reservado' : body.status === 'Vendido' ? 'Vendido' : body.status === 'Alugado' ? 'Alugado' : 'Disponível',
  };
}

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    return NextResponse.json({ data: await listProperties() });
  } catch (error) {
    console.error('property_list_failed', error);
    return NextResponse.json({ error: 'Não foi possível carregar os imóveis.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    const input = propertyInput(await request.json() as Record<string, unknown>);
    if (!input.code || !input.title || !input.description || !input.district || !input.city || !input.price || !input.propertyType || input.bedrooms == null || input.parkingSpaces == null || input.area == null) return NextResponse.json({ error: 'Preencha os campos obrigatórios.' }, { status: 400 });
    const data = await createProperty(input);
    after(runAutomationsAfterEvent);
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('property_create_failed', error);
    return NextResponse.json({ error: 'Não foi possível salvar o imóvel.' }, { status: 500 });
  }
}
