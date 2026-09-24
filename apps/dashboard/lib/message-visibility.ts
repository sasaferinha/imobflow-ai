// Presentation only. The original message and processing/delivery records stay intact.
export const HIDDEN_MESSAGE_TEXT = 'Mensagem removida do painel.';

export function hideMessageContent<T extends { text: string }>(message: T): T & { hidden: true; canHide: false } {
  return { ...message, text: HIDDEN_MESSAGE_TEXT, images: [], audios: [], propertyTitle: undefined,
    hidden: true, canHide: false, canRetry: false, deliveryError: undefined, nextAttemptAt: undefined };
}
