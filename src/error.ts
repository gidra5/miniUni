export enum ErrorType {
  /** unknown origins of error */
  UNKNOWN,

  /** unexpected end of source */
  END_OF_SOURCE,

  /** unterminated string token */
  UNTERMINATED_STRING,

  /** invalid binary literal */
  INVALID_BINARY_LITERAL,

  /** invalid octal literal */
  INVALID_OCTAL_LITERAL,

  /** invalid hex literal */
  INVALID_HEX_LITERAL,
}

const errorMessages = {
  [ErrorType.UNKNOWN]: 'Unknown error',
  [ErrorType.END_OF_SOURCE]: 'Unexpected end of source',
  [ErrorType.UNTERMINATED_STRING]:
    'Unterminated string literal. Expected closing double quote "',
  [ErrorType.INVALID_BINARY_LITERAL]:
    'In binary literals after 0b there must be 0 or 1',
  [ErrorType.INVALID_OCTAL_LITERAL]:
    'In octal literals after 0o there must be a digit between 0 and 7',
  [ErrorType.INVALID_HEX_LITERAL]:
    'In hex literals after 0x there must be a digit between 0 and 9 or a letter between a and f (case insensitive)',
};

type Options = {
  cause?: unknown;
};

export class SystemError extends Error {
  private constructor(private type: ErrorType, options: Options = {}) {
    super('SystemError: ' + type, { cause: options.cause });
  }

  display(): string {
    return errorMessages[this.type];
  }

  setCause(cause: unknown): SystemError {
    this.cause = cause;
    return this;
  }

  getType(): ErrorType {
    return this.type;
  }

  static unknown(): SystemError {
    return new SystemError(ErrorType.UNKNOWN);
  }

  static endOfSource(): SystemError {
    return new SystemError(ErrorType.END_OF_SOURCE);
  }

  static unterminatedString(): SystemError {
    return new SystemError(ErrorType.UNTERMINATED_STRING);
  }

  static invalidBinaryLiteral(): SystemError {
    return new SystemError(ErrorType.INVALID_BINARY_LITERAL);
  }

  static invalidOctalLiteral(): SystemError {
    return new SystemError(ErrorType.INVALID_OCTAL_LITERAL);
  }

  static invalidHexLiteral(): SystemError {
    return new SystemError(ErrorType.INVALID_HEX_LITERAL);
  }
}
