import { z } from 'zod';
import { WhatsAppProviderError } from './errors.js';

const recipientSchema = z.string().trim().min(8).max(30);

export const sendTextSchema = z
  .object({
    to: recipientSchema,
    text: z.string().trim().min(1).max(4_096),
    previewUrl: z.boolean().optional(),
  })
  .strict();

export const sendImageSchema = z
  .object({
    to: recipientSchema,
    imageUrl: z
      .string()
      .url()
      .refine((value) => /^https?:\/\//i.test(value), 'A URL da imagem deve usar HTTP ou HTTPS')
      .optional(),
    mediaId: z.string().trim().min(1).max(500).optional(),
    caption: z.string().trim().min(1).max(1_024).optional(),
  })
  .strict()
  .refine((value) => Number(value.imageUrl !== undefined) + Number(value.mediaId !== undefined) === 1, {
    message: 'Informe exatamente um entre imageUrl e mediaId',
    path: ['imageUrl'],
  });

export const sendTemplateSchema = z
  .object({
    to: recipientSchema,
    templateName: z.string().trim().regex(/^[a-z0-9_]{1,512}$/),
    languageCode: z.string().trim().regex(/^[a-z]{2}(?:_[A-Z]{2})?$/).default('pt_BR'),
    bodyParameters: z.array(z.string().max(1_024)).max(20).default([]),
  })
  .strict();

export function normalizeRecipient(recipient: string): string {
  const parsed = recipientSchema.safeParse(recipient);
  if (!parsed.success) throw invalidRecipient(parsed.error);
  const digits = parsed.data.replace(/[^\d]/g, '');
  if (!/^\d{8,15}$/.test(digits)) throw invalidRecipient();
  return digits;
}

function invalidRecipient(cause?: unknown): WhatsAppProviderError {
  return new WhatsAppProviderError('Número de WhatsApp destinatário inválido.', {
    code: 'INVALID_RECIPIENT',
    retryable: false,
    cause,
  });
}
