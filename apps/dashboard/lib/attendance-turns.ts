import { supabaseServiceRequest } from './supabase';
import type { InterestProfile } from './ai/qualification';

export const ATTENDANCE_DEBOUNCE_MS = 3_000;
type TurnScope = { companyId: string; conversationId: string };
export type AttendanceTurnMessage = {
  externalMessageId: string;
  message: string;
  hasImage: boolean;
  hasAudio: boolean;
  occurredAt: string;
};
export type ClaimedAttendanceTurn = {
  status: 'claimed';
  token: string;
  watermark: number;
  key: string;
  latestOccurredAt: string;
  lastReply: string | null;
  messages: AttendanceTurnMessage[];
  overflow: boolean;
};
export type AttendanceTurnClaim = ClaimedAttendanceTurn
  | { status: 'deferred'; retryAfterMs: number }
  | { status: 'ignored' };
export type AttendanceTurnResult = { status: 'queued'; messageId: string }
  | { status: 'superseded' | 'suppressed' | 'cancelled' };

/** Only bot handoffs in a final/ambiguous state are reconciled; ordinary outbox
 * sending/recovery functions and manual messages are not modified. */
export async function reconcileAttendanceHandoffs(input?: { companyId: string; conversationId?: string }): Promise<number> {
  return supabaseServiceRequest<number>('rpc/reconcile_attendance_handoffs', {
    method: 'POST', timeoutMs: 4_000,
    body: { p_company_id: input?.companyId || null, p_conversation_id: input?.conversationId || null },
  });
}

/** A database lease coordinates distinct serverless webhook/recovery workers. */
export async function claimAttendanceTurn(input: TurnScope): Promise<AttendanceTurnClaim> {
  return supabaseServiceRequest<AttendanceTurnClaim>('rpc/claim_attendance_turn', {
    method: 'POST', timeoutMs: 4_000,
    body: { p_company_id: input.companyId, p_conversation_id: input.conversationId },
  });
}

/** The profile CAS, inbound acknowledgement and outgoing enqueue share one transaction. */
export async function enqueueAttendanceTurn(
  input: TurnScope,
  turn: ClaimedAttendanceTurn,
  content: string,
  options: { handoff?: boolean; profilePatch?: InterestProfile; profileVersion?: string } = {},
): Promise<AttendanceTurnResult> {
  return supabaseServiceRequest<AttendanceTurnResult>('rpc/enqueue_attendance_turn', {
    method: 'POST', timeoutMs: 4_000,
    body: {
      p_company_id: input.companyId, p_conversation_id: input.conversationId,
      p_token: turn.token, p_watermark: turn.watermark, p_content: content,
      p_profile: options.profilePatch || {}, p_profile_version: options.profileVersion || null,
      p_handoff: options.handoff === true,
    },
  });
}

/** Releases only this lease; a delayed worker cannot release its successor. */
export async function releaseAttendanceTurn(input: TurnScope, turn: ClaimedAttendanceTurn): Promise<void> {
  await supabaseServiceRequest('rpc/release_attendance_turn', {
    method: 'POST', timeoutMs: 4_000,
    body: { p_company_id: input.companyId, p_conversation_id: input.conversationId, p_token: turn.token },
  });
}
