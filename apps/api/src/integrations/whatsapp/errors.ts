export type WhatsAppProviderErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'INVALID_PAYLOAD'
  | 'INVALID_RECIPIENT'
  | 'NETWORK_ERROR'
  | 'REQUEST_TIMEOUT'
  | 'HTTP_ERROR'
  | 'INVALID_RESPONSE';

export interface WhatsAppProviderErrorOptions {
  code: WhatsAppProviderErrorCode;
  retryable: boolean;
  statusCode?: number;
  cause?: unknown;
}

export class WhatsAppProviderError extends Error {
  readonly code: WhatsAppProviderErrorCode;
  readonly retryable: boolean;
  readonly statusCode: number | undefined;

  constructor(message: string, options: WhatsAppProviderErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'WhatsAppProviderError';
    this.code = options.code;
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
  }
}
