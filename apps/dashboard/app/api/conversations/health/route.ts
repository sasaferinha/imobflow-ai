import { NextResponse } from "next/server";
import { protectedRoute } from "@/lib/accounts";
import { requireCompanyId } from "@/lib/tenant-context";
import { supabaseServiceRequest as db } from "@/lib/supabase";
import { loadMetaWhatsAppConnectionForCompany } from "@/lib/meta-whatsapp-connections";
export const GET = protectedRoute(async () => {
  try {
    const company = requireCompanyId();
    const [incoming, outgoing, events, settings, whatsapp] = await Promise.all([
      db<unknown[]>(
        `messages?company_id=eq.${company}&direction=eq.incoming&select=id&limit=1`,
      ),
      db<Array<{ delivery_status: string }>>(
        `messages?company_id=eq.${company}&direction=eq.outgoing&select=delivery_status&order=created_at.desc&limit=1`,
      ),
      db<Array<{ status: string }>>(
        `message_delivery_events?company_id=eq.${company}&select=status&order=occurred_at.desc&limit=1`,
      ),
      db<Array<{ last_scheduler_at: string | null }>>(
        `conversation_settings?company_id=eq.${company}&select=last_scheduler_at&limit=1`,
      ),
      loadMetaWhatsAppConnectionForCompany(company),
    ]);
    const whatsappConnection = whatsapp[0];
    return NextResponse.json({
      data: {
        database: "Conectado",
        webhook: incoming.length
          ? "Recebimento registrado"
          : "Aguardando primeiro recebimento",
        meta:
          !whatsappConnection
            ? "WhatsApp ainda não configurado"
            : events[0]?.status === "failed" ||
              outgoing[0]?.delivery_status === "failed"
            ? "Falha no último envio"
            : events[0]?.status === "read" || events[0]?.status === "delivered"
            ? "Última entrega confirmada"
            : (events[0]?.status === "sent" || outgoing[0]?.delivery_status === "sent")
              ? "Mensagem enviada (aguardando confirmação)"
              : "Entrega ainda não confirmada",
        ai: process.env.OPENAI_API_KEY?.trim() ? "IA configurada · roteiro básico em caso de falha" : "Roteiro básico ativo · IA não configurada",
        scheduler: settings[0]?.last_scheduler_at
          ? `Última execução: ${new Date(settings[0].last_scheduler_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
          : "Execução ainda não confirmada",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível verificar as integrações." },
      { status: 503 },
    );
  }
});
