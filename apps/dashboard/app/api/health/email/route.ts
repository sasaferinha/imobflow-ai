import { NextResponse } from 'next/server';
import { passwordEmailConfig } from '@/lib/password-recovery';

export const dynamic = 'force-dynamic';

export function GET() {
  const config = passwordEmailConfig();
  const status = config.configured ? 200 : 503;
  return NextResponse.json(
    {
      service: 'email',
      provider: 'resend',
      configured: config.configured,
      apiKeyConfigured: config.apiKeySet,
      baseUrl: config.baseUrl,
      from: config.from,
      replyTo: config.replyTo,
      nextStep: config.configured
        ? null
        : 'Configure RESEND_API_KEY e PASSWORD_EMAIL_FROM no ambiente da Vercel, depois faça um novo deploy.',
    },
    { status },
  );
}
