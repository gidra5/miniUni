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

  /** missing closing parens */
  MISSING_TOKEN,

  /** invalid pattern */
  INVALID_PATTERN,

  /** tuple pattern on non-tuple */
  INVALID_TUPLE_PATTERN,
}

type Options = {
  cause?: unknown;
  data?: Record<string, any>;
};

export class SystemError extends Error {
  data: Record<string, any> = {};
  private constructor(private type: ErrorType, options: Options = {}) {
    super('SystemError: ' + type, { cause: options.cause });
  }

  display(): string {
    switch (this.type) {
      case ErrorType.UNKNOWN:
        return 'Unknown error';
      case ErrorType.END_OF_SOURCE:
        return 'Unexpected end of source';
      case ErrorType.UNTERMINATED_STRING:
        return 'Unterminated string literal. Expected closing double quote "';
      case ErrorType.INVALID_BINARY_LITERAL:
        return 'In binary literals after 0b there must be 0 or 1';
      case ErrorType.INVALID_OCTAL_LITERAL:
        return 'In octal literals after 0o there must be a digit between 0 and 7';
      case ErrorType.INVALID_HEX_LITERAL:
        return 'In hex literals after 0x there must be a digit between 0 and 9 or a letter between a and f (case insensitive)';
      case ErrorType.MISSING_TOKEN:
        const tokens = this.data.tokens as string[];
        const list = tokens.map((token) => `"${token}"`).join(' or ');
        return `Missing token: ${list}`;
      case ErrorType.INVALID_PATTERN:
        return 'invalid pattern';
      case ErrorType.INVALID_TUPLE_PATTERN:
        return 'tuple pattern on non-tuple';
        return 'spread operator can only be used during tuple construction';
        return 'token operator should only be used during parsing';
        return "placeholder can't be evaluated";
        return 'receive operator on non-channel';
        return 'send operator on non-channel';
        return 'index is not an integer';
        return 'indexing on non-list';
        return `can't assign to undeclared variable: ${this.data.name}`;
        return 'length on non-list';
        return 'floor on non-number';
    }
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

  static missingToken(...tokens: string[]): SystemError {
    return new SystemError(ErrorType.MISSING_TOKEN, { data: { tokens } });
  }

  static invalidDeclarationPattern(): SystemError {
    return new SystemError(ErrorType.INVALID_PATTERN);
  }
}
