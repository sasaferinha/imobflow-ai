/** Conversation registration is an explicit human confirmation, never an AI inference. */
export const REGISTRATION_ACTIONS = ['lead', 'attendance', 'schedule', 'visit', 'proposal', 'close'] as const;
export type RegistrationAction = typeof REGISTRATION_ACTIONS[number];
export const REGISTRATION_CHANNELS = ['WhatsApp', 'Telefone', 'Email', 'Presencial', 'Outro'] as const;
export const REGISTRATION_OUTCOMES = ['Contato realizado', 'Tentativa sem resposta'] as const;
export type RegistrationCommon = { purpose?: 'Venda' | 'Aluguel'; notes?: string };
export type RegistrationData = {
  lead: RegistrationCommon & { reason?: string };
  attendance: RegistrationCommon & { channel: typeof REGISTRATION_CHANNELS[number]; outcome: typeof REGISTRATION_OUTCOMES[number] };
  schedule: RegistrationCommon & { taskId?: string; propertyId: string; dueAt: string };
  visit: RegistrationCommon & ({ taskId: string; propertyId?: never; occurredAt?: never } | { taskId?: never; propertyId: string; occurredAt: string });
  proposal: RegistrationCommon & { propertyId: string; amount: number; conditions: string; expiresAt: string; status: 'Enviada' | 'Em negociação' };
  close: RegistrationCommon & { proposalId: string; confirmed: true; reason?: string };
};
export type RegistrationCommand = {
  [A in RegistrationAction]: { type: 'register'; caseId: string; requestId: string; action: A; data: RegistrationData[A] }
}[RegistrationAction];
