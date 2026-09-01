export type LLMProviderErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'NETWORK_ERROR'
  | 'REQUEST_TIMEOUT'
  | 'HTTP_ERROR'
  | 'INVALID_RESPONSE'
  | 'INVALID_STRUCTURED_OUTPUT'
  | 'REFUSAL';

export interface LLMProviderErrorOptions {
  code: LLMProviderErrorCode;
  retryable: boolean;
  statusCode?: number;
  cause?: unknown;
}

export class LLMProviderError extends Error {
  readonly code: LLMProviderErrorCode;
  readonly retryable: boolean;
  readonly statusCode: number | undefined;

  constructor(message: string, options: LLMProviderErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'LLMProviderError';
    this.code = options.code;
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
  }
}
