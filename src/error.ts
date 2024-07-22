import {
  createLabelInfo,
  Diagnostic,
  LabelInfo,
  primaryDiagnosticLabel,
  secondaryDiagnosticLabel,
} from 'codespan-napi';
import { assert } from './utils.js';
import { fileMap } from './files.js';
import { AbstractSyntaxTree } from './parser.js';
import { Position } from './position.js';

export enum ErrorType {
  UNKNOWN,
  END_OF_SOURCE,
  UNTERMINATED_STRING,
  INVALID_BINARY_LITERAL,
  INVALID_OCTAL_LITERAL,
  INVALID_HEX_LITERAL,
  MISSING_TOKEN,
  INVALID_PATTERN,
  INVALID_TUPLE_PATTERN,
  INVALID_APPLICATION_EXPRESSION,
  INVALID_TOKEN_EXPRESSION,
  INVALID_RECEIVE_CHANNEL,
  INVALID_SEND_CHANNEL,
  INVALID_USE_OF_SPREAD,
  INVALID_INDEX,
  INVALID_INDEX_TARGET,
  INVALID_ASSIGNMENT,
  INVALID_LENGTH_TARGET,
  INVALID_FLOOR_TARGET,
  INVALID_PLACEHOLDER_EXPRESSION,
}

type Options = {
  cause?: unknown;
  fileId?: number;
  data?: Record<string, any>;
  node?: AbstractSyntaxTree;
};

export class SystemError extends Error {
  data: Record<string, any>;
  private fileId?: number;
  private type: ErrorType;
  private node?: AbstractSyntaxTree;
  private constructor(type: ErrorType, msg: string, options: Options = {}) {
    super(msg, { cause: options.cause });
    this.data = options.data || {};
    this.fileId = options.fileId;
    this.type = type;
    this.node = options.node;
  }

  withFileId(fileId: number): SystemError {
    this.fileId = fileId;
    return this;
  }

  withCause(cause: unknown): SystemError {
    this.cause = cause;
    return this;
  }

  withNode(node: AbstractSyntaxTree): SystemError {
    this.node = node;
    return this;
  }

  print(): void {
    const diag = this.diagnostic();
    diag.emitStd(fileMap);
  }

  diagnostic(): Diagnostic {
    assert(this.fileId !== undefined, 'fileId is not set for SystemError');
    const id = this.fileId;
    const diag = Diagnostic.error();
    diag.withMessage(this.message);
    const labels = this.labels().map((label) =>
      primaryDiagnosticLabel(id, label)
    );
    diag.withLabels(labels);
    return diag;
  }

  labels(): Array<LabelInfo> {
    const labels: Array<LabelInfo> = [];

    switch (this.type) {
      case ErrorType.UNKNOWN:
      case ErrorType.END_OF_SOURCE:
      case ErrorType.UNTERMINATED_STRING:
      case ErrorType.INVALID_BINARY_LITERAL:
      case ErrorType.INVALID_OCTAL_LITERAL:
      case ErrorType.INVALID_HEX_LITERAL:
      case ErrorType.MISSING_TOKEN:
      case ErrorType.INVALID_PATTERN: {
        assert(this.node, 'node is not set');
        const pos = this.node.data.position as Position;
        labels.push(createLabelInfo(pos.start, pos.end, 'here'));
      }
      case ErrorType.INVALID_TUPLE_PATTERN:
      case ErrorType.INVALID_USE_OF_SPREAD:
      case ErrorType.INVALID_TOKEN_EXPRESSION:
      case ErrorType.INVALID_PLACEHOLDER_EXPRESSION:
      case ErrorType.INVALID_RECEIVE_CHANNEL:
      case ErrorType.INVALID_SEND_CHANNEL:
      case ErrorType.INVALID_INDEX:
      case ErrorType.INVALID_INDEX_TARGET:
      case ErrorType.INVALID_ASSIGNMENT:
      case ErrorType.INVALID_LENGTH_TARGET:
      case ErrorType.INVALID_FLOOR_TARGET:
      case ErrorType.INVALID_APPLICATION_EXPRESSION: {
        assert(this.node, 'node is not set');
        const pos = this.node.data.position as Position;
        labels.push(createLabelInfo(pos.start, pos.end, 'here'));
      }
    }

    return labels;
  }

  static unknown(): SystemError {
    const msg = 'Unknown error';
    return new SystemError(ErrorType.UNKNOWN, msg);
  }

  static endOfSource(): SystemError {
    const msg = 'Unexpected end of source';
    return new SystemError(ErrorType.END_OF_SOURCE, msg);
  }

  static unterminatedString(): SystemError {
    const msg = 'Unterminated string literal. Expected closing double quote "';
    return new SystemError(ErrorType.UNTERMINATED_STRING, msg);
  }

  static invalidBinaryLiteral(): SystemError {
    const msg = 'In binary literals after 0b there must be 0 or 1';
    return new SystemError(ErrorType.INVALID_BINARY_LITERAL, msg);
  }

  static invalidOctalLiteral(): SystemError {
    const msg =
      'In octal literals after 0o there must be a digit between 0 and 7';
    return new SystemError(ErrorType.INVALID_OCTAL_LITERAL, msg);
  }

  static invalidHexLiteral(): SystemError {
    const msg =
      'In hex literals after 0x there must be a digit between 0 and 9 or a letter between a and f (case insensitive)';
    return new SystemError(ErrorType.INVALID_HEX_LITERAL, msg);
  }

  static missingToken(...tokens: string[]): SystemError {
    const options = { data: { tokens } };

    const list = tokens.map((token) => `"${token}"`).join(' or ');
    const msg = `Missing token: ${list}`;

    return new SystemError(ErrorType.MISSING_TOKEN, msg, options);
  }

  static invalidPattern(): SystemError {
    const msg = 'invalid pattern';
    return new SystemError(ErrorType.INVALID_PATTERN, msg);
  }

  static invalidPlaceholderExpression(): SystemError {
    const msg = "placeholder can't be evaluated";
    return new SystemError(ErrorType.INVALID_PLACEHOLDER_EXPRESSION, msg);
  }

  static invalidFloorTarget(): SystemError {
    const msg = 'floor on non-number';
    return new SystemError(ErrorType.INVALID_FLOOR_TARGET, msg);
  }

  static invalidLengthTarget(): SystemError {
    const msg = 'length on non-list';
    return new SystemError(ErrorType.INVALID_LENGTH_TARGET, msg);
  }

  static invalidAssignment(name: string): SystemError {
    const msg = `can't assign to undeclared variable: ${name}`;

    const options = { data: { name } };
    return new SystemError(ErrorType.INVALID_ASSIGNMENT, msg, options);
  }

  static invalidTuplePattern(): SystemError {
    const msg = 'tuple pattern on non-tuple';
    return new SystemError(ErrorType.INVALID_TUPLE_PATTERN, msg);
  }

  static invalidIndexTarget(): SystemError {
    const msg = 'indexing on non-list';
    return new SystemError(ErrorType.INVALID_INDEX_TARGET, msg);
  }

  static invalidIndex(): SystemError {
    const msg = 'index is not an integer';
    return new SystemError(ErrorType.INVALID_INDEX, msg);
  }

  static invalidUseOfSpread(): SystemError {
    const msg = 'spread operator can only be used during tuple construction';

    return new SystemError(ErrorType.INVALID_USE_OF_SPREAD, msg);
  }

  static invalidSendChannel(): SystemError {
    const msg = 'send operator on non-channel';
    return new SystemError(ErrorType.INVALID_SEND_CHANNEL, msg);
  }

  static invalidReceiveChannel(): SystemError {
    const msg = 'receive operator on non-channel';
    return new SystemError(ErrorType.INVALID_RECEIVE_CHANNEL, msg);
  }

  static invalidTokenExpression(): SystemError {
    const msg = 'token operator should only be used during parsing';
    return new SystemError(ErrorType.INVALID_TOKEN_EXPRESSION, msg);
  }

  static invalidApplicationExpression(): SystemError {
    const msg = 'application operator on non-function';
    return new SystemError(ErrorType.INVALID_APPLICATION_EXPRESSION, msg);
  }
}
