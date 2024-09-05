import {
  Diagnostic,
  LabelInfo,
  primaryDiagnosticLabel,
  secondaryDiagnosticLabel,
} from 'codespan-napi';
import { assert } from './utils.js';
import { Position } from './position.js';
import { inject, Injectable } from './injector.js';

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
  INVALID_ASSIGNMENT,
  INVALID_PLACEHOLDER_EXPRESSION,
  EVALUATION_ERROR,
  UNDECLARED_NAME,
  INVALID_OBJECT_PATTERN,
  IMPORT_FAILED,
  IMPORT_RESOLVE_FAILED,
  INVALID_INCREMENT_ASSIGN,
}

type Options = {
  cause?: unknown;
  fileId?: number;
  data?: Record<string, any>;
  notes?: string[];
  labels?: ErrorLabel[];
};

type ErrorLabel = LabelInfo & {
  kind: 'primary' | 'secondary';
};

export class SystemError extends Error {
  data: Record<string, any>;
  fileId?: number;
  private type: ErrorType;
  private labels: ErrorLabel[];
  private notes: string[];
  private constructor(type: ErrorType, msg: string, options: Options = {}) {
    super(msg, { cause: options.cause });
    this.data = options.data ?? {};
    this.fileId = options.fileId;
    this.type = type;
    this.notes = options.notes ?? [];
    this.labels = options.labels ?? [];
  }

  toObject(): any {
    return { ...this, type: ErrorType[this.type], message: this.message };
  }

  withFileId(fileId: number): SystemError {
    this.fileId = fileId;
    return this;
  }

  withCause(cause: unknown): SystemError {
    this.cause = cause;
    return this;
  }

  print(): SystemError {
    const fileMap = inject(Injectable.FileMap);
    const diag = this.diagnostic();
    diag.emitStd(fileMap);
    return this;
  }

  diagnostic(): Diagnostic {
    assert(this.fileId !== undefined, 'fileId is not set for SystemError');
    const id = this.fileId;
    const diag = Diagnostic.error();
    diag.withMessage(this.message);
    diag.withCode(ErrorType[this.type]);
    const labels = this.labels.map(({ kind, ...label }) =>
      kind === 'primary'
        ? primaryDiagnosticLabel(id, label)
        : secondaryDiagnosticLabel(id, label)
    );
    diag.withLabels(labels);
    diag.withNotes(this.notes);
    return diag;
  }

  static unknown(): SystemError {
    const msg = 'Unknown error';
    return new SystemError(ErrorType.UNKNOWN, msg);
  }

  static endOfSource(pos: Position): SystemError {
    const msg = 'Unexpected end of source';
    const labels: Array<ErrorLabel> = [];
    const options = { labels };

    labels.push({
      start: pos.start,
      end: pos.end,
      message: 'here',
      kind: 'primary',
    });

    return new SystemError(ErrorType.END_OF_SOURCE, msg, options);
  }

  static unterminatedString(pos: Position): SystemError {
    const msg = 'Unterminated string literal';
    const labels: Array<ErrorLabel> = [];
    const notes: string[] = [];
    const options = { notes, labels };

    labels.push({
      start: pos.start,
      end: pos.end,
      message: 'expected closing double quote',
      kind: 'primary',
    });
    notes.push('Strings must be enclosed in double quotes (")');
    notes.push('Use \\ to escape special characters');
    notes.push('Use \\ at the end of a line to write a multi-line string');

    return new SystemError(ErrorType.UNTERMINATED_STRING, msg, options);
  }

  static invalidBinaryLiteral(pos: Position): SystemError {
    const msg = 'Invalid binary literal';
    const labels: Array<ErrorLabel> = [];
    const notes: string[] = [];
    const options = { notes, labels };

    labels.push({
      start: pos.start + 2,
      end: pos.start + 3,
      message: 'expected digits 0 or 1',
      kind: 'primary',
    });
    notes.push(
      'Valid binary literals start with 0b and digits 0 or 1 (binary digits), which may be followed by more binary digits, optionally separated by underscores'
    );
    return new SystemError(ErrorType.INVALID_BINARY_LITERAL, msg, options);
  }

  static invalidOctalLiteral(pos: Position): SystemError {
    const msg = 'Invalid octal literal';
    const labels: Array<ErrorLabel> = [];
    const notes: string[] = [];
    const options = { notes, labels };

    labels.push({
      start: pos.start + 2,
      end: pos.start + 3,
      message: 'expected a digit between 0 and 7',
      kind: 'primary',
    });
    notes.push(
      'Valid octal literals start with 0o and a digit between 0 and 7 (octal digits), which may be followed by more octal digits, optionally separated by underscores'
    );
    return new SystemError(ErrorType.INVALID_OCTAL_LITERAL, msg, options);
  }

  static invalidHexLiteral(pos: Position): SystemError {
    const msg = 'Invalid hex literal';
    const labels: Array<ErrorLabel> = [];
    const notes: string[] = [];
    const options = { notes, labels };

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
    return new SystemError(ErrorType.INVALID_HEX_LITERAL, msg, options);
  }

  static missingToken(pos: Position, ...tokens: string[]): SystemError {
    const list = tokens.map((token) => `"${token}"`).join(' or ');
    const msg = `Missing token, expected one of: ${list}`;
    const labels: Array<ErrorLabel> = [];
    const notes: string[] = [];
    const options = { notes, labels };

    labels.push({
      start: pos.start,
      end: pos.end,
      message: 'somewhere here',
      kind: 'primary',
    });

    return new SystemError(ErrorType.MISSING_TOKEN, msg, options);
  }

  static invalidPattern(pos: Position): SystemError {
    const msg = 'invalid pattern';
    const labels: Array<ErrorLabel> = [];
    const notes: string[] = [];
    const options = { notes, labels };
    labels.push({
      start: pos.start,
      end: pos.end,
      message: 'here',
      kind: 'primary',
    });
    return new SystemError(ErrorType.INVALID_PATTERN, msg, options);
  }

  static invalidPlaceholderExpression(pos: Position): SystemError {
    const msg = "placeholder can't be evaluated";
    const labels: Array<ErrorLabel> = [];
    const options = { labels };

    labels.push({
      start: pos.start,
      end: pos.end,
      message: 'here',
      kind: 'primary',
    });

    return new SystemError(
      ErrorType.INVALID_PLACEHOLDER_EXPRESSION,
      msg,
      options
    );
  }

  static invalidAssignment(
    name: string,
    pos: Position,
    closestName?: string
  ): SystemError {
    const msg = `can't assign to undeclared variable`;
    const labels: Array<ErrorLabel> = [];
    const notes: string[] = [];
    const options = { notes, labels };

    labels.push({
      start: pos.start,
      end: pos.end,
      message: `variable "${name}" is not declared in scope`,
      kind: 'primary',
    });
    notes.push(`Variable must be declared before it can be assigned to.`);
    notes.push(
      `Use := operator to declare a new variable, = assigns to already declared variables only.`
    );
    if (closestName) notes.push(`Did you mean "${closestName}"?`);
    else {
      notes.push(
        `Check if you have a typo in the variable name, if "${name}" is intended to be declared.`
      );
    }

    return new SystemError(ErrorType.INVALID_ASSIGNMENT, msg, options);
  }

  static invalidTuplePattern(pos: Position): SystemError {
    const msg = 'tuple pattern on non-tuple';
    const labels: Array<ErrorLabel> = [];
    const notes: string[] = [];
    const options = { notes, labels };

    labels.push({
      start: pos.start,
      end: pos.end,
      message: 'here',
      kind: 'primary',
    });

    return new SystemError(ErrorType.INVALID_TUPLE_PATTERN, msg, options);
  }

  static evaluationError(
    msg: string,
    notes: string[],
    pos: Position
  ): SystemError {
    const labels: Array<ErrorLabel> = [];
    const options = { notes, labels };

    labels.push({
      start: pos.start,
      end: pos.end,
      message: "can't evaluate this expression",
      kind: 'primary',
    });
    return new SystemError(ErrorType.EVALUATION_ERROR, msg, options);
  }

  static invalidArgumentType(
    name: string,
    signature: { args: [label: string, type: string][]; returns: string },
    pos: Position
  ) {
    return (argIndex: number) => {
      const argSignature = signature.args[argIndex];
      const msg = `${name} ${argSignature[0]} expected ${argSignature[1]}`;
      const argNote = `${name} expects ${argSignature[1]} ${
        argSignature[0]
      } as the ${argIndex + 1} argument`;
      const signatureStringifiedArgs = signature.args
        .map(([label, type]) => `${label}: ${type}`)
        .join(', ');
      const signatureNote = `${name} signature is: (${signatureStringifiedArgs}) => ${signature.returns}`;
      return SystemError.evaluationError(msg, [argNote, signatureNote], pos);
    };
  }

  static invalidIndexTarget(pos: Position): SystemError {
    return SystemError.evaluationError(
      'index operator expects a list or record value on the left side',
      [],
      pos
    );
  }

  static invalidIndex(pos: Position): SystemError {
    return SystemError.evaluationError(
      'index operator expects an integer, string or symbol',
      [],
      pos
    );
  }

  static invalidUseOfSpread(pos: Position): SystemError {
    return SystemError.evaluationError(
      'spread operator can only be used during tuple construction',
      [],
      pos
    );
  }

  static invalidSendChannel(pos: Position): SystemError {
    return SystemError.evaluationError(
      'send operator expects a channel on the left side',
      [],
      pos
    );
  }

  static invalidReceiveChannel(pos: Position): SystemError {
    return SystemError.evaluationError(
      'receive operator expects a channel on the right side',
      [],
      pos
    );
  }

  static channelClosed(pos: Position): SystemError {
    return SystemError.evaluationError('channel is already closed', [], pos);
  }

  static invalidTokenExpression(pos: Position): SystemError {
    return SystemError.evaluationError(
      'token operator should only be used during parsing',
      [],
      pos
    );
  }

  static invalidApplicationExpression(pos: Position): SystemError {
    const msg = 'application on a non-function';
    const labels: Array<ErrorLabel> = [];
    const notes: string[] = [];
    const options = { notes, labels };

    labels.push({
      start: pos.start,
      end: pos.end,
      message: 'this expression is not a function',
      kind: 'primary',
    });
    return new SystemError(
      ErrorType.INVALID_APPLICATION_EXPRESSION,
      msg,
      options
    );
  }

  static importFailed(
    name: string,
    resolved: string,
    error: unknown
  ): SystemError {
    const msg = 'import failed';
    const notes: string[] = [];
    const options = { notes };

    notes.push(`name: "${name}"`);
    notes.push(`resolved name: "${resolved}"`);
    if (error instanceof Error) notes.push(`error: "${error.message}"`);
    else notes.push(`error: "${error}"`);

    return new SystemError(ErrorType.IMPORT_FAILED, msg, options);
  }

  static undeclaredName(name: string, pos: Position): SystemError {
    const msg = `undeclared name ${name}`;
    const labels: Array<ErrorLabel> = [];
    const notes: string[] = [];
    const options = { notes, labels };

    labels.push({
      start: pos.start,
      end: pos.end,
      message: 'this name is not declared in scope',
      kind: 'primary',
    });

    notes.push(
      `Variable can be declared with ":=" operator like this: ${name} := value`
    );
    return new SystemError(ErrorType.UNDECLARED_NAME, msg, options);
  }

  static invalidObjectPattern(pos: Position): SystemError {
    const msg = 'object pattern on non-object';
    const labels: Array<ErrorLabel> = [];
    const notes: string[] = [];
    const options = { notes, labels };

    labels.push({
      start: pos.start,
      end: pos.end,
      message: 'here',
      kind: 'primary',
    });

    return new SystemError(ErrorType.INVALID_OBJECT_PATTERN, msg, options);
  }

  static invalidIncrement(name: string, pos: Position) {
    const msg = `can't increment a non number variable`;
    const labels: Array<ErrorLabel> = [];
    const notes: string[] = [];
    const options = { notes, labels };

    labels.push({
      start: pos.start,
      end: pos.end,
      message: `value of "${name}" is not a number`,
      kind: 'primary',
    });
    notes.push(
      `To use += operator, all names in its pattern should have number values`
    );

    return new SystemError(ErrorType.INVALID_INCREMENT_ASSIGN, msg, options);
  }

  static invalidIncrementValue(pos: Position) {
    const msg = `can't increment by a non number`;
    const labels: Array<ErrorLabel> = [];
    const notes: string[] = [];
    const options = { notes, labels };

    labels.push({
      start: pos.start,
      end: pos.end,
      message: `value is not a number`,
      kind: 'primary',
    });
    notes.push(
      `To use += operator, value to be incremented by should be a number`
    );

    return new SystemError(ErrorType.INVALID_INCREMENT_ASSIGN, msg, options);
  }

  static unresolvedImport(name: string, error: unknown) {
    const msg = "can't resolve import";
    const notes: string[] = [];
    const options = { notes };

    notes.push(`name: "${name}"`);
    if (error instanceof Error) notes.push(`error: "${error.message}"`);
    else notes.push(`error: "${error}"`);

    return new SystemError(ErrorType.IMPORT_RESOLVE_FAILED, msg, options);
  }

  static unbalancedOpenToken(
    tokens: [string, string],
    openPos: Position,
    closePos: Position
  ): SystemError {
    const msg = `Missing closing token`;
    const labels: Array<ErrorLabel> = [];
    const options = { labels };

    labels.push({
      start: closePos.start,
      end: closePos.end,
      message: `must be closed with "${tokens[1]}" by that point`,
      kind: 'primary',
    });
    labels.push({
      start: openPos.start,
      end: openPos.end,
      message: `opening token "${tokens[0]}" here`,
      kind: 'primary',
    });

    return new SystemError(ErrorType.MISSING_TOKEN, msg, options);
  }

  static unbalancedCloseToken(
    tokens: [string, string],
    pos: Position
  ): SystemError {
    const msg = `Unexpected closing token "${tokens[1]}"`;
    const labels: Array<ErrorLabel> = [];
    const options = { labels };

    labels.push({
      start: pos.start,
      end: pos.end,
      message: 'unexpected closing token',
      kind: 'primary',
    });

    return new SystemError(ErrorType.MISSING_TOKEN, msg, options);
  }
}
