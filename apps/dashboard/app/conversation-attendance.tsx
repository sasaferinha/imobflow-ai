type AttendanceMode = 'automatic' | 'human' | 'paused' | 'closed' | 'unknown';

export type AttendanceSnapshot = {
  attendanceMode?: AttendanceMode;
  assignedTo?: string | null;
  assignedBrokerId?: string | null;
};

export type ConversationAttendance = {
  mode: AttendanceMode;
  owner: string | null;
  isCurrentBroker: boolean;
  canClaim: boolean;
  canRelease: boolean;
  canSend: boolean;
  title: string;
  description: string;
};

export function describeConversationAttendance({ snapshot, currentBrokerId, isAdministrator, lifecycleStatus, hasMessages }: {
  snapshot?: AttendanceSnapshot;
  currentBrokerId?: string;
  isAdministrator?: boolean;
  lifecycleStatus?: string;
  hasMessages: boolean;
}): ConversationAttendance {
  const mode = snapshot?.attendanceMode || 'unknown';
  const owner = snapshot?.assignedTo?.trim() || null;
  // Names identify the person to the reader; only the persisted ID grants controls.
  const isCurrentBroker = Boolean(currentBrokerId && snapshot?.assignedBrokerId === currentBrokerId);
  const hasOwner = Boolean(owner || snapshot?.assignedBrokerId);
  const leadFinished = lifecycleStatus === 'Convertido' || lifecycleStatus === 'Perdido';
  const canClaim = Boolean(currentBrokerId && mode !== 'unknown' && mode !== 'closed' && !hasOwner);
  const canManageHumanConversation = Boolean(isAdministrator || isCurrentBroker);
  const canRelease = Boolean(mode !== 'closed' && !leadFinished
    && (mode === 'human' || mode === 'paused') && (canManageHumanConversation || !hasOwner));
  const permissions = { owner, isCurrentBroker, canClaim, canRelease, canSend: canManageHumanConversation && mode !== 'closed' && mode !== 'unknown' };

  if (mode === 'closed') return { ...permissions, mode, title: 'Encerrada', description: 'Esta conversa está encerrada. O bot não responde enquanto ela permanecer nesse estado.' };
  if (mode === 'human') return { ...permissions, mode, title: 'Bot pausado — atendimento humano',
    description: `O bot fica em silêncio enquanto o atendimento está com ${owner || 'um corretor'}. ${leadFinished ? `O lead também está marcado como ${lifecycleStatus?.toLocaleLowerCase('pt-BR')}.` : isCurrentBroker ? 'Ao devolver ao bot, ele responderá às próximas mensagens do cliente.' : 'O corretor responsável pode devolver a conversa ao bot.'}` };
  if (mode === 'paused') return { ...permissions, mode, title: 'Bot pausado — aguardando atendimento humano',
    description: leadFinished ? `O bot não responde porque o lead está marcado como ${lifecycleStatus?.toLocaleLowerCase('pt-BR')}.` : 'As mensagens chegam ao histórico, mas o bot não responde. Assuma o atendimento ou devolva ao bot para retomar as próximas mensagens.' };
  if (leadFinished) return { ...permissions, mode: 'paused', canRelease: false, title: `Bot pausado — lead ${lifecycleStatus?.toLocaleLowerCase('pt-BR')}`,
    description: 'O atendimento automático não responde a leads convertidos ou perdidos. Revise a etapa do lead antes de retomar o atendimento.' };
  if (mode === 'automatic') return { ...permissions, mode, title: 'Automático', description: 'O bot responde às novas mensagens do cliente. Assumir o atendimento pausa as respostas automáticas.' };
  return { ...permissions, mode, title: 'Status não confirmado', description: hasMessages
    ? 'Não foi possível confirmar o modo de atendimento desta conversa. Aguarde a sincronização.'
    : 'Aguardando uma conversa do canal conectado para confirmar o atendimento automático.' };
}

export function ConversationAttendanceBadge({ attendance }: { attendance: ConversationAttendance }) {
  return <span className="conversation-attendance-badge" data-mode={attendance.mode}>
    {attendance.mode === 'human' || attendance.mode === 'paused' ? 'Bot pausado' : attendance.title}
  </span>;
}

export function ConversationAttendanceBanner({ attendance, ready, saving, release }: {
  attendance: ConversationAttendance;
  ready: boolean;
  saving: boolean;
  release: () => void;
}) {
  return <section className="conversation-attendance" data-mode={attendance.mode} aria-label="Status do atendimento">
    <div role="status" aria-live="polite" aria-atomic="true">
      <strong>{attendance.title}</strong>
      <details className="conversation-attendance-help"><summary>Sobre o atendimento</summary>
        {attendance.owner && <span className="conversation-attendance-owner">Responsável: {attendance.owner}{attendance.isCurrentBroker ? ' (você)' : ''}</span>}
        <p>{attendance.description}</p>
      </details>
      {!ready && <p>Aguardando sincronização para confirmar o estado atual.</p>}
    </div>
    {attendance.canRelease && <button type="button" disabled={!ready || saving} onClick={release}>Devolver ao bot</button>}
  </section>;
}
