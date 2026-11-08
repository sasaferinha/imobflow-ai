export type LeadChannel = 'whatsapp' | 'instagram' | 'facebook';

/** Source is an acquisition label; only explicit messaging sources select a social inbox. */
export function leadChannel(source: unknown): LeadChannel {
  const text = typeof source === 'string' ? source.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() : '';
  if (text.includes('instagram')) return 'instagram';
  if (text.includes('facebook') && !text.includes('lead ads') && !text.includes('formulario')) return 'facebook';
  return 'whatsapp';
}
export const channelLabel = (channel: LeadChannel) => ({ whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook' })[channel];
