import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { WhatsAppProviderError } from './errors.js';
import type { JsonValue, ParsedInboundMessage, WhatsAppMessageType } from './whatsapp-provider.js';

const mediaSchema = z
  .object({
    id: z.string().min(1),
    mime_type: z.string().min(1).optional(),
    sha256: z.string().min(1).optional(),
    caption: z.string().optional(),
    filename: z.string().optional(),
  })
  .passthrough();

const inboundMessageSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    timestamp: z.string().regex(/^\d+$/),
    type: z.string().min(1),
    text: z.object({ body: z.string() }).passthrough().optional(),
    image: mediaSchema.optional(),
    audio: mediaSchema.optional(),
    document: mediaSchema.optional(),
    button: z.object({ text: z.string().optional(), payload: z.string().optional() }).passthrough().optional(),
    interactive: z
      .object({
        type: z.string().optional(),
        button_reply: z.object({ id: z.string(), title: z.string() }).passthrough().optional(),
        list_reply: z.object({ id: z.string(), title: z.string(), description: z.string().optional() }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const webhookSchema = z
  .object({
    object: z.string().optional(),
    entry: z.array(
      z
        .object({
          id: z.string().optional(),
          changes: z.array(
            z
              .object({
                field: z.string().optional(),
                value: z
                  .object({
                    messaging_product: z.string().optional(),
                    metadata: z
                      .object({
                        display_phone_number: z.string().optional(),
                        phone_number_id: z.string().min(1),
                      })
                      .passthrough()
                      .optional(),
                    contacts: z
                      .array(
                        z
                          .object({
                            wa_id: z.string().optional(),
                            profile: z.object({ name: z.string().optional() }).passthrough().optional(),
                          })
                          .passthrough(),
                      )
                      .optional(),
                    messages: z.array(inboundMessageSchema).optional(),
                  })
                  .passthrough(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export function parseMetaWebhookPayload(payload: unknown): ParsedInboundMessage[] {
  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success) {
    throw new WhatsAppProviderError('Payload de webhook da Meta inválido.', {
      code: 'INVALID_PAYLOAD',
      retryable: false,
      cause: parsed.error,
    });
  }

  const inbound: ParsedInboundMessage[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const messages = change.value.messages ?? [];
      if (messages.length > 0 && !change.value.metadata?.phone_number_id) {
        throw new WhatsAppProviderError('Webhook da Meta sem phone_number_id.', {
          code: 'INVALID_PAYLOAD',
          retryable: false,
        });
      }

      for (const message of messages) {
        const timestamp = new Date(Number(message.timestamp) * 1_000);
        if (Number.isNaN(timestamp.getTime())) {
          throw new WhatsAppProviderError('Webhook da Meta com timestamp inválido.', {
            code: 'INVALID_PAYLOAD',
            retryable: false,
          });
        }
        const contact =
          change.value.contacts?.find((candidate) => candidate.wa_id === message.from) ??
          change.value.contacts?.[0];
        const normalized = normalizeMessageContent(message);

        inbound.push({
          whatsappMessageId: message.id,
          from: message.from,
          senderName: contact?.profile?.name?.trim() || null,
          phoneNumberId: change.value.metadata?.phone_number_id ?? '',
          businessAccountId: entry.id ?? null,
          content: normalized.content,
          messageType: normalized.messageType,
          timestamp,
          metadata: normalized.metadata,
        });
      }
    }
  }
  return inbound;
}

export function verifyMetaWebhookSignature(
  rawBody: string | Uint8Array,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith('sha256=') || appSecret.length === 0) return false;
  const suppliedHex = signatureHeader.slice('sha256='.length);
  if (!/^[a-fA-F0-9]{64}$/.test(suppliedHex)) return false;

  const raw = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : Buffer.from(rawBody);
  const expected = createHmac('sha256', appSecret).update(raw).digest();
  const supplied = Buffer.from(suppliedHex, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function normalizeMessageContent(message: z.infer<typeof inboundMessageSchema>): {
  content: string;
  messageType: WhatsAppMessageType;
  metadata: { [key: string]: JsonValue };
} {
  if (message.type === 'text' && message.text) {
    return { content: message.text.body.trim(), messageType: 'TEXT', metadata: { providerType: 'text' } };
  }
  if (message.type === 'image' && message.image) {
    return {
      content: message.image.caption?.trim() || '[imagem]',
      messageType: 'IMAGE',
      metadata: compactMetadata('image', message.image),
    };
  }
  if (message.type === 'audio' && message.audio) {
    return {
      content: '[áudio]',
      messageType: 'AUDIO',
      metadata: compactMetadata('audio', message.audio),
    };
  }
  if (message.type === 'document' && message.document) {
    return {
      content: message.document.caption?.trim() || message.document.filename?.trim() || '[documento]',
      messageType: 'DOCUMENT',
      metadata: compactMetadata('document', message.document),
    };
  }
  if (message.type === 'interactive' && message.interactive) {
    const reply = message.interactive.button_reply ?? message.interactive.list_reply;
    return {
      content: reply?.title.trim() || '[resposta interativa]',
      messageType: reply ? 'TEXT' : 'UNKNOWN',
      metadata: {
        providerType: 'interactive',
        interactiveType: message.interactive.type ?? 'unknown',
        ...(reply ? { replyId: reply.id } : {}),
      },
    };
  }
  if (message.type === 'button' && message.button) {
    return {
      content: message.button.text?.trim() || '[resposta de botão]',
      messageType: message.button.text ? 'TEXT' : 'UNKNOWN',
      metadata: {
        providerType: 'button',
        ...(message.button.payload ? { buttonPayload: message.button.payload } : {}),
      },
    };
  }

  return {
    content: `[mensagem ${message.type}]`,
    messageType: 'UNKNOWN',
    metadata: { providerType: message.type },
  };
}

function compactMetadata(
  providerType: string,
  media: z.infer<typeof mediaSchema>,
): { [key: string]: JsonValue } {
  return {
    providerType,
    mediaId: media.id,
    ...(media.mime_type ? { mimeType: media.mime_type } : {}),
    ...(media.sha256 ? { sha256: media.sha256 } : {}),
    ...(media.caption ? { caption: media.caption } : {}),
    ...(media.filename ? { filename: media.filename } : {}),
  };
}
