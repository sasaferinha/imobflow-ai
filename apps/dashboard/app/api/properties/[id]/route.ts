import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { deleteProperty, updateProperty } from '@/lib/database';
import type { PropertyInput } from '@/lib/operations';

export const runtime = 'nodejs';

function clean(value: unknown, max = 300) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanImages(value: unknown) {
  if (!Array.isArray(value)) return [];
  const images = value.filter((image): image is string => typeof image === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(image) && image.length <= 700_000).slice(0, 5);
  return images.reduce<string[]>((accepted, image) => accepted.join('').length + image.length <= 3_200_000 ? [...accepted, image] : accepted, []);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const input: PropertyInput = {
      title: clean(body.title, 160), district: clean(body.district, 120), price: clean(body.price, 80), meta: clean(body.meta, 500),
      match: Math.max(0, Math.min(100, Number(body.match) || 80)), tone: clean(body.tone, 30) || 'orchid', purpose: body.purpose === 'Aluguel' ? 'Aluguel' : 'Venda', images: cleanImages(body.images),
    };
    if (!input.title || !input.district || !input.price || !input.meta) return NextResponse.json({ error: 'Preencha os campos obrigatórios.' }, { status: 400 });
    const data = await updateProperty((await context.params).id, input);
    return data ? NextResponse.json({ data }) : NextResponse.json({ error: 'Imóvel não encontrado.' }, { status: 404 });
  } catch (error) {
    console.error('property_update_failed', error);
    return NextResponse.json({ error: 'Não foi possível atualizar o imóvel.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    return await deleteProperty((await context.params).id)
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: 'Imóvel não encontrado.' }, { status: 404 });
  } catch (error) {
    console.error('property_delete_failed', error);
    return NextResponse.json({ error: 'Não foi possível excluir o imóvel.' }, { status: 500 });
  }
}
