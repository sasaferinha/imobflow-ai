export type WhatsAppMessageType = 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT' | 'TEMPLATE' | 'UNKNOWN';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ParsedInboundMessage {
  whatsappMessageId: string;
  from: string;
  senderName: string | null;
  phoneNumberId: string;
  businessAccountId: string | null;
  content: string;
  messageType: WhatsAppMessageType;
  timestamp: Date;
  metadata: { [key: string]: JsonValue };
}

export interface SendTextInput {
  to: string;
  text: string;
  previewUrl?: boolean;
}

export interface SendImageInput {
  to: string;
  imageUrl?: string;
  mediaId?: string;
  caption?: string;
}

export interface SendTemplateInput {
  to: string;
  templateName: string;
  languageCode?: string;
  bodyParameters?: readonly string[];
}

export interface WhatsAppSendResult {
  whatsappMessageId: string;
  to: string;
  sentAt: Date;
}

export interface WhatsAppProvider {
  readonly providerName: string;

  verifyWebhookSignature(rawBody: string | Uint8Array, signatureHeader: string | undefined): boolean;

  parseWebhook(payload: unknown): ParsedInboundMessage[];

  sendText(input: SendTextInput): Promise<WhatsAppSendResult>;

  sendImage(input: SendImageInput): Promise<WhatsAppSendResult>;

  sendTemplate(input: SendTemplateInput): Promise<WhatsAppSendResult>;

  markAsRead(whatsappMessageId: string): Promise<void>;
}
