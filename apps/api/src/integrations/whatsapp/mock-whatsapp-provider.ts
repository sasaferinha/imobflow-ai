import { randomUUID } from 'node:crypto';
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

export type MockSentWhatsAppMessage =
  | { type: 'TEXT'; to: string; text: string; previewUrl: boolean; result: WhatsAppSendResult }
  | { type: 'IMAGE'; to: string; imageUrl: string | null; mediaId: string | null; caption: string | null; result: WhatsAppSendResult }
  | { type: 'TEMPLATE'; to: string; templateName: string; languageCode: string; bodyParameters: string[]; result: WhatsAppSendResult };

export interface MockWhatsAppProviderOptions {
  appSecret?: string;
  now?: () => Date;
  idGenerator?: () => string;
}

export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly providerName = 'mock';

  private readonly appSecret: string | undefined;
  private readonly now: () => Date;
  private readonly idGenerator: () => string;
  private readonly sentMessages: MockSentWhatsAppMessage[] = [];
  private readonly readMessageIds = new Set<string>();

  constructor(options: MockWhatsAppProviderOptions = {}) {
    this.appSecret = options.appSecret;
    this.now = options.now ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? randomUUID;
  }

  verifyWebhookSignature(rawBody: string | Uint8Array, signatureHeader: string | undefined): boolean {
    if (!this.appSecret) return true;
    return verifyMetaWebhookSignature(rawBody, signatureHeader, this.appSecret);
  }

  parseWebhook(payload: unknown): ParsedInboundMessage[] {
    return parseMetaWebhookPayload(payload);
  }

  async sendText(input: SendTextInput): Promise<WhatsAppSendResult> {
    const parsed = sendTextSchema.parse(input);
    const to = normalizeRecipient(parsed.to);
    const result = this.createResult(to);
    this.sentMessages.push({
      type: 'TEXT',
      to,
      text: parsed.text,
      previewUrl: parsed.previewUrl ?? false,
      result,
    });
    return result;
  }

  async sendImage(input: SendImageInput): Promise<WhatsAppSendResult> {
    const parsed = sendImageSchema.parse(input);
    const to = normalizeRecipient(parsed.to);
    const result = this.createResult(to);
    this.sentMessages.push({
      type: 'IMAGE',
      to,
      imageUrl: parsed.imageUrl ?? null,
      mediaId: parsed.mediaId ?? null,
      caption: parsed.caption ?? null,
      result,
    });
    return result;
  }

  async sendTemplate(input: SendTemplateInput): Promise<WhatsAppSendResult> {
    const parsed = sendTemplateSchema.parse(input);
    const to = normalizeRecipient(parsed.to);
    const result = this.createResult(to);
    this.sentMessages.push({
      type: 'TEMPLATE',
      to,
      templateName: parsed.templateName,
      languageCode: parsed.languageCode,
      bodyParameters: [...parsed.bodyParameters],
      result,
    });
    return result;
  }

  async markAsRead(whatsappMessageId: string): Promise<void> {
    const normalized = whatsappMessageId.trim();
    if (normalized) this.readMessageIds.add(normalized);
  }

  getSentMessages(): readonly MockSentWhatsAppMessage[] {
    return this.sentMessages.map((message) => ({ ...message, result: { ...message.result } }));
  }

  wasMarkedAsRead(whatsappMessageId: string): boolean {
    return this.readMessageIds.has(whatsappMessageId);
  }

  clear(): void {
    this.sentMessages.length = 0;
    this.readMessageIds.clear();
  }

  private createResult(to: string): WhatsAppSendResult {
    return {
      whatsappMessageId: `mock-${this.idGenerator()}`,
      to,
      sentAt: this.now(),
    };
  }
}
