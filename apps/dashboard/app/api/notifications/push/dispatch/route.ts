import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { dispatchBrowserPush } from '@/lib/web-push-dispatch';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const secret=process.env.CRON_SECRET;
  if(!secret)return NextResponse.json({error:'Rotina não configurada.'},{status:503});
  const actual=Buffer.from(request.headers.get('authorization') || ''),expected=Buffer.from(`Bearer ${secret}`);
  if(actual.length!==expected.length || !timingSafeEqual(actual,expected))return NextResponse.json({error:'Não autorizado.'},{status:401});
  try {return NextResponse.json(await dispatchBrowserPush(),{headers:{'Cache-Control':'no-store'}});}
  catch {return NextResponse.json({error:'Não foi possível concluir as notificações.'},{status:503});}
}
