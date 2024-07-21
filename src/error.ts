import {
  Diagnostic,
  primaryDiagnosticLabel,
  secondaryDiagnosticLabel,
} from 'codespan-napi';

export enum ErrorType {
  /** unknown origins of error */
  UNKNOWN,

  /** unexpected end of source */
  END_OF_SOURCE,

  /** unterminated string token */
  UNTERMINATED_STRING,

  /** invalid binary number literal */
  INVALID_BINARY_LITERAL,

  /** invalid octal number literal */
  INVALID_OCTAL_LITERAL,

  /** invalid hex number literal */
  INVALID_HEX_LITERAL,

  /** missing closing tokens */
  MISSING_TOKEN,

  /** invalid pattern syntax */
  INVALID_PATTERN,

  /** tuple pattern on non-tuple */
  INVALID_TUPLE_PATTERN,

  /** invalid application expression */
  INVALID_APPLICATION_EXPRESSION,

  /** invalid token expression */
  INVALID_TOKEN_EXPRESSION,

  /** invalid receive channel */
  INVALID_RECEIVE_CHANNEL,

  /** invalid send channel */
  INVALID_SEND_CHANNEL,

  /** invalid use of spread */
  INVALID_USE_OF_SPREAD,

  /** invalid index */
  INVALID_INDEX,

  /** invalid index target */
  INVALID_INDEX_TARGET,

  /** invalid assignment */
  INVALID_ASSIGNMENT,

  /** invalid length target */
  INVALID_LENGTH_TARGET,

  /** invalid floor target */
  INVALID_FLOOR_TARGET,

  /** placeholders can't be evaluated as expressions */
  INVALID_PLACEHOLDER_EXPRESSION,
}

type Options = {
  fileId?: string;
  cause?: unknown;
  data?: Record<string, any>;
};

export class SystemError extends Error {
  data: Record<string, any> = {};
  private constructor(private type: ErrorType, options: Options = {}) {
    super('SystemError: ' + type, { cause: options.cause });
  }

  printError(error, fileId) {
    const errorDiagnosticLabel = (error) => {
      if (error.cause.length > 0)
        return error.cause.flatMap(errorDiagnosticLabel);

      const label = secondaryDiagnosticLabel(fileId, {
        ...error.pos,
        message: error.message,
      });
      return label;
    };
    const diagnostic = Diagnostic.error();
    diagnostic.withLabels([
      primaryDiagnosticLabel(fileId, {
        ...error.pos,
        message: error.message,
      }),
      ...error.cause.flatMap(errorDiagnosticLabel),
    ]);
    return diagnostic;
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
      case ErrorType.MISSING_TOKEN: {
        const tokens = this.data.tokens as string[];
        const list = tokens.map((token) => `"${token}"`).join(' or ');
        return `Missing token: ${list}`;
      }
      case ErrorType.INVALID_PATTERN:
        return 'invalid pattern';
      case ErrorType.INVALID_TUPLE_PATTERN:
        return 'tuple pattern on non-tuple';
      case ErrorType.INVALID_USE_OF_SPREAD:
        return 'spread operator can only be used during tuple construction';
      case ErrorType.INVALID_TOKEN_EXPRESSION:
        return 'token operator should only be used during parsing';
      case ErrorType.INVALID_PLACEHOLDER_EXPRESSION:
        return "placeholder can't be evaluated";
      case ErrorType.INVALID_RECEIVE_CHANNEL:
        return 'receive operator on non-channel';
      case ErrorType.INVALID_SEND_CHANNEL:
        return 'send operator on non-channel';
      case ErrorType.INVALID_INDEX:
        return 'index is not an integer';
      case ErrorType.INVALID_INDEX_TARGET:
        return 'indexing on non-list';
      case ErrorType.INVALID_ASSIGNMENT:
        return `can't assign to undeclared variable: ${this.data.name}`;
      case ErrorType.INVALID_LENGTH_TARGET:
        return 'length on non-list';
      case ErrorType.INVALID_FLOOR_TARGET:
        return 'floor on non-number';
      case ErrorType.INVALID_APPLICATION_EXPRESSION:
        return 'application operator on non-function';
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

  static invalidPattern(): SystemError {
    return new SystemError(ErrorType.INVALID_PATTERN);
  }

  static invalidPlaceholderExpression(): SystemError {
    return new SystemError(ErrorType.INVALID_PLACEHOLDER_EXPRESSION);
  }

  static invalidFloorTarget(): SystemError {
    return new SystemError(ErrorType.INVALID_FLOOR_TARGET);
  }

  static invalidLengthTarget(): SystemError {
    return new SystemError(ErrorType.INVALID_LENGTH_TARGET);
  }

  static invalidAssignment(name: string): SystemError {
    return new SystemError(ErrorType.INVALID_ASSIGNMENT, { data: { name } });
  }

  static invalidTuplePattern(): SystemError {
    return new SystemError(ErrorType.INVALID_TUPLE_PATTERN);
  }

  static invalidIndexTarget(): SystemError {
    return new SystemError(ErrorType.INVALID_INDEX_TARGET);
  }

  static invalidIndex(): SystemError {
    return new SystemError(ErrorType.INVALID_INDEX);
  }

  static invalidUseOfSpread(): SystemError {
    return new SystemError(ErrorType.INVALID_USE_OF_SPREAD);
  }

  static invalidSendChannel(): SystemError {
    return new SystemError(ErrorType.INVALID_SEND_CHANNEL);
  }

  static invalidReceiveChannel(): SystemError {
    return new SystemError(ErrorType.INVALID_RECEIVE_CHANNEL);
  }

  static invalidTokenExpression(): SystemError {
    return new SystemError(ErrorType.INVALID_TOKEN_EXPRESSION);
  }

  static invalidApplicationExpression(): SystemError {
    return new SystemError(ErrorType.INVALID_APPLICATION_EXPRESSION);
  }
}
