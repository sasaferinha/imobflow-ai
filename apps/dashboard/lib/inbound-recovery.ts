import { supabaseServiceRequest } from './supabase';
import { loadMetaWhatsAppConnectionForCompany } from './meta-whatsapp-connections';
import { respondToIncomingMessage, type AttendanceInput } from './attendance';
import { reconcileAttendanceHandoffs } from './attendance-turns';

export async function recoverInboundReply(deadline: number) {
  if (Date.now() + 44000 > deadline) return { processed: 0, failed: 0 };
  // Only bot handoffs are reconciled here. Legacy/manual outbox semantics stay unchanged.
  await reconcileAttendanceHandoffs();
  if (Date.now() + 44000 > deadline) return { processed: 0, failed: 0 };
  const input = await supabaseServiceRequest<AttendanceInput | null>('rpc/claim_missing_inbound_reply', { method: 'POST', timeoutMs: 4000 });
  if (!input) return { processed: 0, failed: 0 };
  try {
    const connections = await loadMetaWhatsAppConnectionForCompany(input.companyId);
    const connection = connections.find(item => item.enabled && item.phoneNumberId === input.phoneNumberId);
    if (!connection) throw new Error('connection_unavailable');
    await respondToIncomingMessage({ ...input, apiVersion: connection.apiVersion, accessToken: connection.accessToken }, deadline);
    return { processed: 1, failed: 0 };
  } catch {
    console.error('inbound_reply_recovery_failed');
    return { processed: 0, failed: 1 };
  }
}
