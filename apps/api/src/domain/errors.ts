export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} não encontrado`, 'NOT_FOUND', 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Credenciais inválidas') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class DuplicateMessageError extends AppError {
  constructor(readonly externalMessageId: string) {
    super('Mensagem já processada', 'DUPLICATE_MESSAGE', 409);
  }
}

export class ProviderError extends AppError {
  constructor(provider: string, message: string, details?: unknown) {
    super(`${provider}: ${message}`, 'PROVIDER_ERROR', 502, details);
  }
}
