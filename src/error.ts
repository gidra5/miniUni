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
  INVALID_SPLIT_SEPARATOR,
  INVALID_SPLIT_TARGET,
  INVALID_REPLACE_TARGET,
  INVALID_REPLACE_PATTERN,
  INVALID_REPLACE_REPLACEMENT,
}

type Options = {
  cause?: unknown;
  fileId?: number;
  data?: Record<string, any>;
};

export class SystemError extends Error {
  data: Record<string, any>;
  private fileId?: number;
  private type: ErrorType;
  private constructor(type: ErrorType, msg: string, options: Options = {}) {
    super(msg, { cause: options.cause });
    this.data = options.data || {};
    this.fileId = options.fileId;
    this.type = type;
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
    this.data.node = node;
    return this.withPosition(node.data.position);
  }

  withPosition(position: Position): SystemError {
    this.data.position = position;
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
    diag.withCode(ErrorType[this.type]);
    const [labels, notes] = this.labels();
    diag.withLabels(
      labels.map(({ kind, ...label }) =>
        kind === 'primary'
          ? primaryDiagnosticLabel(id, label)
          : secondaryDiagnosticLabel(id, label)
      )
    );
    diag.withNotes(notes);
    return diag;
  }

  labels(): [
    Array<LabelInfo & { kind: 'primary' | 'secondary' }>,
    Array<string>
  ] {
    const labels: Array<LabelInfo & { kind: 'primary' | 'secondary' }> = [];
    const notes: string[] = [];

    switch (this.type) {
      case ErrorType.INVALID_LENGTH_TARGET:
      case ErrorType.INVALID_FLOOR_TARGET:
      case ErrorType.INVALID_SPLIT_SEPARATOR:
      case ErrorType.INVALID_SPLIT_TARGET:
        break;

      case ErrorType.INVALID_BINARY_LITERAL: {
        assert(this.data.position, 'position is not set');
        const pos = this.data.position as Position;

        labels.push({
          start: pos.start + 2,
          end: pos.start + 3,
          message: 'expected digits 0 or 1',
          kind: 'primary',
        });
        notes.push(
          'Valid binary literals start with 0b and digits 0 or 1 (binary digits), which may be followed by more binary digits, optionally separated by underscores'
        );
        break;
      }
      case ErrorType.INVALID_OCTAL_LITERAL: {
        assert(this.data.position, 'position is not set');
        const pos = this.data.position as Position;

        labels.push({
          start: pos.start + 2,
          end: pos.start + 3,
          message: 'expected a digit between 0 and 7',
          kind: 'primary',
        });
        notes.push(
          'Valid octal literals start with 0o and a digit between 0 and 7 (octal digits), which may be followed by more octal digits, optionally separated by underscores'
        );
        break;
      }
      case ErrorType.INVALID_HEX_LITERAL: {
        assert(this.data.position, 'position is not set');
        const pos = this.data.position as Position;
        labels.push({
          start: pos.start + 2,
          end: pos.start + 3,
          message:
            'expected a digit or a letter between a and f (case insensitive)',
          kind: 'primary',
        });
        notes.push(
          'Valid hex literals start with 0x and a digit or a case insensitive letter between a and f (hex digits), which may be followed by more hex digits, optionally separated by underscores'
        );
        break;
      }

      case ErrorType.UNTERMINATED_STRING: {
        assert(this.data.position, 'position is not set');
        const pos = this.data.position as Position;
        labels.push({
          start: pos.start,
          end: pos.end,
          message: 'expected closing double quote "',
          kind: 'primary',
        });
        notes.push('Strings must be enclosed in double quotes');
        notes.push(
          'Use \\ to escape special characters like double quotes or \\ itself'
        );
        notes.push('Use \\ at the end of a line to write a multi-line string');
        break;
      }

      case ErrorType.UNKNOWN:
      case ErrorType.END_OF_SOURCE:
      case ErrorType.MISSING_TOKEN:
      case ErrorType.INVALID_PATTERN:
      case ErrorType.INVALID_TUPLE_PATTERN:
      case ErrorType.INVALID_USE_OF_SPREAD:
      case ErrorType.INVALID_TOKEN_EXPRESSION:
      case ErrorType.INVALID_PLACEHOLDER_EXPRESSION:
      case ErrorType.INVALID_RECEIVE_CHANNEL:
      case ErrorType.INVALID_SEND_CHANNEL:
      case ErrorType.INVALID_INDEX:
      case ErrorType.INVALID_INDEX_TARGET:
      case ErrorType.INVALID_ASSIGNMENT:
      case ErrorType.INVALID_APPLICATION_EXPRESSION: {
        assert(
          this.data.position,
          `position is not set, ${ErrorType[this.type]}`
        );
        const pos = this.data.position as Position;
        labels.push({
          start: pos.start,
          end: pos.end,
          message: 'here',
          kind: 'primary',
        });
      }
    }

    return [labels, notes];
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
    const msg = 'Invalid binary literal';
    return new SystemError(ErrorType.INVALID_BINARY_LITERAL, msg);
  }

  static invalidOctalLiteral(): SystemError {
    const msg = 'Invalid octal literal';
    return new SystemError(ErrorType.INVALID_OCTAL_LITERAL, msg);
  }

  static invalidHexLiteral(): SystemError {
    const msg = 'Invalid hex literal';
    return new SystemError(ErrorType.INVALID_HEX_LITERAL, msg);
  }

  static missingToken(...tokens: string[]): SystemError {
    const options = { data: { tokens } };

    const list = tokens.map((token) => `"${token}"`).join(' or ');
    const msg = `Missing token: ${list}`;

    return new SystemError(ErrorType.MISSING_TOKEN, msg, options);
  }

  static invalidPattern(node: AbstractSyntaxTree): SystemError {
    const msg = 'invalid pattern';
    return new SystemError(ErrorType.INVALID_PATTERN, msg).withPosition(
      node.data.position
    );
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

  static invalidAssignment(
    name: string,
    node: AbstractSyntaxTree
  ): SystemError {
    const msg = `can't assign to undeclared variable`;

    const options = { data: { name } };
    return new SystemError(
      ErrorType.INVALID_ASSIGNMENT,
      msg,
      options
    ).withPosition(node.data.position);
  }

  static invalidTuplePattern(node: AbstractSyntaxTree): SystemError {
    const msg = 'tuple pattern on non-tuple';
    return new SystemError(ErrorType.INVALID_TUPLE_PATTERN, msg).withPosition(
      node.data.position
    );
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

  static invalidApplicationExpression(node: AbstractSyntaxTree): SystemError {
    const msg = 'application operator on non-function';
    return new SystemError(
      ErrorType.INVALID_APPLICATION_EXPRESSION,
      msg
    ).withPosition(node.data.position);
  }
  static invalidSplitSeparator(): SystemError {
    const msg = 'split separator is not a string';
    return new SystemError(ErrorType.INVALID_SPLIT_SEPARATOR, msg);
  }
  static invalidSplitTarget(): SystemError {
    const msg = 'split target is not a string';

    return new SystemError(ErrorType.INVALID_SPLIT_TARGET, msg);
  }
  static invalidReplaceTarget(): SystemError {
    const msg = 'replace target is not a string';
    return new SystemError(ErrorType.INVALID_REPLACE_TARGET, msg);
  }
  static invalidReplaceReplacement(): SystemError {
    const msg = 'replace replacement is not a string';

    return new SystemError(ErrorType.INVALID_REPLACE_REPLACEMENT, msg);
  }
  static invalidReplacePattern(): SystemError {
    const msg = 'replace pattern is not a string';
    return new SystemError(ErrorType.INVALID_REPLACE_PATTERN, msg);
  }
}
