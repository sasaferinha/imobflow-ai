import { z } from 'zod';
import { WhatsAppProviderError } from './errors.js';
import { parseMetaWebhookPayload, verifyMetaWebhookSignature } from './webhook-parser.js';
import { normalizeRecipient, sendImageSchema, sendTemplateSchema, sendTextSchema } from './validation.js';
import type {
  ParsedInboundMessage,
  SendImageInput,
  SendTemplateInput,
  SendTextInput,
  WhatsAppProvider,
  WhatsAppSendResult,
} from './whatsapp-provider.js';

export interface MetaWhatsAppProviderOptions {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  apiVersion?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface ResolvedMetaOptions {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  apiVersion: string;
  baseUrl: string;
  timeoutMs: number;
}

const optionsSchema = z
  .object({
    accessToken: z.string().trim().min(1),
    phoneNumberId: z.string().trim().regex(/^\d+$/),
    appSecret: z.string().trim().min(1),
    apiVersion: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
    baseUrl: z.string().url().default('https://graph.facebook.com'),
    timeoutMs: z.number().int().min(1_000).max(120_000).default(20_000),
  })
  .strict();

const sendResponseSchema = z
  .object({
    messages: z.array(z.object({ id: z.string().min(1) }).passthrough()).min(1),
  })
  .passthrough();

const metaErrorSchema = z
  .object({
    error: z
      .object({
        message: z.string().optional(),
        code: z.number().int().optional(),
        error_subcode: z.number().int().optional(),
        type: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly providerName = 'meta';

  private readonly options: ResolvedMetaOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MetaWhatsAppProviderOptions) {
    const { fetchImpl, ...rawOptions } = options;
    const parsed = optionsSchema.safeParse(rawOptions);
    if (!parsed.success) {
      throw new WhatsAppProviderError('Configuração inválida do provider Meta WhatsApp.', {
        code: 'CONFIGURATION_ERROR',
        retryable: false,
        cause: parsed.error,
      });
    }
    this.options = {
      ...parsed.data,
      baseUrl: parsed.data.baseUrl.replace(/\/+$/, ''),
    };
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
  }

  verifyWebhookSignature(rawBody: string | Uint8Array, signatureHeader: string | undefined): boolean {
    return verifyMetaWebhookSignature(rawBody, signatureHeader, this.options.appSecret);
  }

  parseWebhook(payload: unknown): ParsedInboundMessage[] {
    return parseMetaWebhookPayload(payload);
  }

  async sendText(input: SendTextInput): Promise<WhatsAppSendResult> {
    const parsed = sendTextSchema.parse(input);
    const to = normalizeRecipient(parsed.to);
    return this.sendMessage(to, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: parsed.previewUrl ?? false, body: parsed.text },
    });
  }

  async sendImage(input: SendImageInput): Promise<WhatsAppSendResult> {
    const parsed = sendImageSchema.parse(input);
    const to = normalizeRecipient(parsed.to);
    const image = {
      ...(parsed.imageUrl ? { link: parsed.imageUrl } : {}),
      ...(parsed.mediaId ? { id: parsed.mediaId } : {}),
      ...(parsed.caption ? { caption: parsed.caption } : {}),
    };
    return this.sendMessage(to, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'image',
      image,
    });
  }

  async sendTemplate(input: SendTemplateInput): Promise<WhatsAppSendResult> {
    const parsed = sendTemplateSchema.parse(input);
    const to = normalizeRecipient(parsed.to);
    const components = parsed.bodyParameters.length
      ? [
          {
            type: 'body',
            parameters: parsed.bodyParameters.map((text) => ({ type: 'text', text })),
          },
        ]
      : undefined;
    return this.sendMessage(to, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: parsed.templateName,
        language: { code: parsed.languageCode },
        ...(components ? { components } : {}),
      },
    });
  }

  async markAsRead(whatsappMessageId: string): Promise<void> {
    const id = whatsappMessageId.trim();
    if (!id) {
      throw new WhatsAppProviderError('ID da mensagem para confirmação de leitura é inválido.', {
        code: 'INVALID_PAYLOAD',
        retryable: false,
      });
    }
    await this.post({ messaging_product: 'whatsapp', status: 'read', message_id: id });
  }

  private async sendMessage(to: string, payload: Record<string, unknown>): Promise<WhatsAppSendResult> {
    const body = await this.post(payload);
    const parsed = sendResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new WhatsAppProviderError('A Meta não retornou o ID da mensagem enviada.', {
        code: 'INVALID_RESPONSE',
        retryable: false,
        cause: parsed.error,
      });
    }
    const firstMessage = parsed.data.messages[0];
    if (!firstMessage) {
      throw new WhatsAppProviderError('A Meta retornou uma lista vazia de mensagens.', {
        code: 'INVALID_RESPONSE',
        retryable: false,
      });
    }
    return { whatsappMessageId: firstMessage.id, to, sentAt: new Date() };
  }

  private async post(payload: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.options.baseUrl}/${this.options.apiVersion}/${this.options.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.options.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.options.timeoutMs),
        },
      );
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
      throw new WhatsAppProviderError(
        timedOut ? 'A requisição à Meta excedeu o tempo limite.' : 'Falha de rede ao chamar a API do WhatsApp.',
        {
          code: timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
          retryable: !timedOut,
          cause: error,
        },
      );
    }

    if (!response.ok) throw await buildMetaHttpError(response);
    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new WhatsAppProviderError('A Meta retornou uma resposta sem JSON válido.', {
        code: 'INVALID_RESPONSE',
        retryable: false,
        cause: error,
      });
    }
  }
}

async function buildMetaHttpError(response: Response): Promise<WhatsAppProviderError> {
  let detail: string | undefined;
  try {
    const body = (await response.json()) as unknown;
    const parsed = metaErrorSchema.safeParse(body);
    if (parsed.success) {
      const code = parsed.data.error.code;
      const subcode = parsed.data.error.error_subcode;
      const suffix = [code, subcode].filter((value) => value !== undefined).join('/');
      detail = `${parsed.data.error.message?.slice(0, 400) ?? 'erro sem descrição'}${suffix ? ` [${suffix}]` : ''}`;
    }
  } catch {
    // O status HTTP é suficiente para classificar o erro.
  }

  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  return new WhatsAppProviderError(
    detail
      ? `A API do WhatsApp rejeitou a requisição (${response.status}): ${detail}`
      : `A API do WhatsApp rejeitou a requisição com status ${response.status}.`,
    { code: 'HTTP_ERROR', retryable, statusCode: response.status },
  );
}
