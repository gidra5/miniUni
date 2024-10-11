import {
  Diagnostic,
  LabelInfo,
  primaryDiagnosticLabel,
  secondaryDiagnosticLabel,
} from 'codespan-napi';
import { assert } from './utils.js';
import { Position } from './position.js';
import { inject, Injectable } from './injector.js';
import { getExprPrecedence, NodeType } from './ast.js';

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
  DUPLICATE_DEFAULT_EXPORT,
  INVALID_DEFAULT_PATTERN,
  INVALID_PIN_PATTERN,
  IMMUTABLE_VARIABLE_ASSIGNMENT,
  MISPLACED_OPERATOR,
  MISSING_OPERAND,
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
  fileId?: number;
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

    if (this.cause instanceof SystemError) {
      const causeMsg = this.cause.message;
      const causeErrorType = ErrorType[this.cause.type];
      this.notes.push(`Caused by: [${causeErrorType}] ${causeMsg}`);
    }

    return this;
  }

  withLabel(
    kind: 'secondary' | 'primary',
    message: string,
    position: Position,
    fileId?: number
  ) {
    if (fileId === undefined) this.labels.push({ ...position, message, kind });
    else this.labels.push({ ...position, message, kind, fileId });

    return this;
  }

  withPrimaryLabel(message: string, position: Position, fileId?: number) {
    return this.withLabel('primary', message, position, fileId);
  }

  withSecondaryLabel(message: string, position: Position, fileId?: number) {
    return this.withLabel('secondary', message, position, fileId);
  }

  withNote(message: string) {
    this.notes.push(message);
    return this;
  }

  withNotes(notes: string[]) {
    this.notes = notes;
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
    const labels = this.labels.map(({ kind, fileId, ...label }) =>
      kind === 'primary'
        ? primaryDiagnosticLabel(fileId ?? id, label)
        : secondaryDiagnosticLabel(fileId ?? id, label)
    );

    diag.withMessage(this.message);
    diag.withCode(ErrorType[this.type]);
    diag.withLabels(labels);
    diag.withNotes(this.notes);

    return diag;
  }

  static unknown(): SystemError {
    return new SystemError(ErrorType.UNKNOWN, 'Unknown error');
  }

  static endOfSource(pos: Position): SystemError {
    return new SystemError(
      ErrorType.END_OF_SOURCE,
      'Unexpected end of source'
    ).withPrimaryLabel('here', pos);
  }

  static unterminatedString(pos: Position): SystemError {
    return new SystemError(
      ErrorType.UNTERMINATED_STRING,
      'Unterminated string literal'
    )
      .withPrimaryLabel('expected closing double quote', pos)
      .withNote('Strings must be enclosed in double quotes (")')
      .withNote('Use \\ to escape special characters');
  }

  static invalidBinaryLiteral(pos: Position): SystemError {
    return new SystemError(
      ErrorType.INVALID_BINARY_LITERAL,
      'Invalid binary literal'
    )
      .withPrimaryLabel('expected digits 0 or 1', {
        start: pos.start + 2,
        end: pos.start + 3,
      })
      .withNote(
        'Valid binary literals start with 0b and digits 0 or 1 (binary digits), which may be followed by more binary digits, optionally separated by underscores'
      );
  }

  static invalidOctalLiteral(pos: Position): SystemError {
    return new SystemError(
      ErrorType.INVALID_OCTAL_LITERAL,
      'Invalid octal literal'
    )
      .withPrimaryLabel('expected a digit between 0 and 7', {
        start: pos.start + 2,
        end: pos.start + 3,
      })
      .withNote(
        'Valid octal literals start with 0o and a digit between 0 and 7 (octal digits), which may be followed by more octal digits, optionally separated by underscores'
      );
  }

  static invalidHexLiteral(pos: Position): SystemError {
    return new SystemError(ErrorType.INVALID_HEX_LITERAL, 'Invalid hex literal')
      .withPrimaryLabel(
        'expected a digit or a letter between a and f (case insensitive)',
        { start: pos.start + 2, end: pos.start + 3 }
      )
      .withNote(
        'Valid hex literals start with 0x and a digit or a case insensitive letter between a and f (hex digits), which may be followed by more hex digits, optionally separated by underscores'
      );
  }

  static missingToken(pos: Position, ...tokens: string[]): SystemError {
    const list = tokens.map((token) => `"${token}"`).join(' or ');
    return new SystemError(
      ErrorType.MISSING_TOKEN,
      `Missing token, expected one of: ${list}`
    ).withPrimaryLabel('somewhere here', pos);
  }

  static invalidPattern(pos: Position): SystemError {
    return new SystemError(
      ErrorType.INVALID_PATTERN,
      'invalid pattern'
    ).withPrimaryLabel('here', pos);
  }

  static invalidPlaceholderExpression(pos: Position): SystemError {
    return new SystemError(
      ErrorType.INVALID_PLACEHOLDER_EXPRESSION,
      "placeholder can't be evaluated"
    ).withPrimaryLabel('here', pos);
  }

  static invalidAssignment(
    name: string,
    pos: Position,
    closestName?: string
  ): SystemError {
    const error = new SystemError(
      ErrorType.INVALID_ASSIGNMENT,
      `can't assign to undeclared variable`
    )
      .withPrimaryLabel(`variable "${name}" is not declared in scope`, pos)
      .withNote('Variable must be declared before it can be assigned to.')
      .withNote(
        'Use := operator to declare a new variable, = assigns to already declared variables only.'
      );

    return closestName
      ? error.withNote(`Did you mean "${closestName}"?`)
      : error.withNote(
          `Check if you have a typo in the variable name, if "${name}" is intended to be declared.`
        );
  }

  static invalidTuplePattern(pos: Position): SystemError {
    return new SystemError(
      ErrorType.INVALID_TUPLE_PATTERN,
      'tuple pattern on non-tuple'
    ).withPrimaryLabel('here', pos);
  }

  static evaluationError(
    msg: string,
    notes: string[],
    pos: Position
  ): SystemError {
    return new SystemError(ErrorType.EVALUATION_ERROR, msg)
      .withPrimaryLabel("can't evaluate this expression", pos)
      .withNotes(notes);
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
    return new SystemError(
      ErrorType.INVALID_APPLICATION_EXPRESSION,
      'application on a non-function'
    ).withPrimaryLabel('this expression is not a function', pos);
  }

  static importFailed(
    name: string,
    resolved: string,
    error: unknown
  ): SystemError {
    const err = new SystemError(ErrorType.IMPORT_FAILED, 'import failed')
      .withNote(`name: "${name}"`)
      .withNote(`resolved name: "${resolved}"`);
    return error instanceof Error
      ? err.withNote(`error: "${error.message}"`)
      : err.withNote(`error: "${error}"`);
  }

  static undeclaredName(name: string, pos: Position): SystemError {
    return new SystemError(ErrorType.UNDECLARED_NAME, `undeclared name ${name}`)
      .withPrimaryLabel('this name is not declared in scope', pos)
      .withNote(
        `Variable can be declared with ":=" operator like this: ${name} := value`
      );
  }

  static invalidObjectPattern(pos: Position): SystemError {
    return new SystemError(
      ErrorType.INVALID_OBJECT_PATTERN,
      'object pattern on non-object'
    ).withPrimaryLabel('here', pos);
  }

  static invalidIncrement(name: string, pos: Position): SystemError {
    return new SystemError(
      ErrorType.INVALID_INCREMENT_ASSIGN,
      "can't increment a non-number variable"
    )
      .withPrimaryLabel(`value of "${name}" is not a number`, pos)
      .withNote(
        `To use += operator, all names in its pattern should have number values`
      );
  }

  static invalidIncrementValue(pos: Position): SystemError {
    return new SystemError(
      ErrorType.INVALID_INCREMENT_ASSIGN,
      "can't increment by a non-number"
    )
      .withPrimaryLabel('value is not a number', pos)
      .withNote(
        `To use += operator, value to be incremented by should be a number`
      );
  }

  static unresolvedImport(name: string, error: unknown): SystemError {
    const err = new SystemError(
      ErrorType.IMPORT_RESOLVE_FAILED,
      "can't resolve import"
    ).withNote(`name: "${name}"`);
    return error instanceof Error
      ? err.withNote(`error: "${error.message}"`)
      : err.withNote(`error: "${error}"`);
  }

  static unbalancedOpenToken(
    tokens: [string, string],
    openPos: Position,
    closePos: Position
  ): SystemError {
    return new SystemError(ErrorType.MISSING_TOKEN, 'Missing closing token')
      .withPrimaryLabel(
        `must be closed with "${tokens[1]}" by that point`,
        closePos
      )
      .withPrimaryLabel(`opening token "${tokens[0]}" here`, openPos);
  }

  static unbalancedCloseToken(
    tokens: [string, string],
    pos: Position
  ): SystemError {
    return new SystemError(
      ErrorType.MISSING_TOKEN,
      `Unexpected closing token "${tokens[1]}"`
    ).withPrimaryLabel('unexpected closing token', pos);
  }

  static duplicateDefaultExport(pos: Position): SystemError {
    return new SystemError(
      ErrorType.DUPLICATE_DEFAULT_EXPORT,
      'Cannot have multiple default exports in a module'
    ).withPrimaryLabel('unexpected default export', pos);
  }

  static invalidDefaultPattern(pos: Position): SystemError {
    return new SystemError(
      ErrorType.INVALID_DEFAULT_PATTERN,
      "default value for pattern can't be an operator"
    ).withPrimaryLabel('unexpected default pattern', pos);
  }

  static invalidPinPattern(pos: Position): SystemError {
    return new SystemError(
      ErrorType.INVALID_PIN_PATTERN,
      "pin value for pattern can't be an operator"
    ).withPrimaryLabel('unexpected pin pattern', pos);
  }

  static immutableVariableAssignment(
    patternKey: string,
    pos: Position
  ): SystemError {
    return new SystemError(
      ErrorType.IMMUTABLE_VARIABLE_ASSIGNMENT,
      'expected mutable name'
    ).withPrimaryLabel(
      `variable "${patternKey}" is not declared as mutable`,
      pos
    );
  }

  static infixOperatorInPrefixPosition(
    src: string,
    op: NodeType,
    pos: Position
  ): SystemError {
    const precedence = getExprPrecedence(op);
    const isInfix = precedence[1] !== null;
    return new SystemError(
      ErrorType.MISPLACED_OPERATOR,
      'infix/postfix operator in prefix position'
    )
      .withPrimaryLabel(
        `Operator "${src}" can't be used in prefix position`,
        pos
      )
      .withNote(
        isInfix
          ? `The "${src}" operator is an infix operator. Provide another operand to the left from it`
          : `The "${src}" operator is a postfix operator. Provide an operand to the left from it`
      );
  }

  static prefixOperatorInRhsPosition(
    src: string,
    op: NodeType,
    pos: Position
  ): SystemError {
    return new SystemError(
      ErrorType.MISPLACED_OPERATOR,
      'prefix operator in infix/postfix position'
    ).withPrimaryLabel(
      `Operator "${src}" can't be used in infix/postfix position`,
      pos
    );
  }

  static missingOperand(pos: Position): SystemError {
    return new SystemError(
      ErrorType.MISSING_OPERAND,
      'missing operand'
    ).withPrimaryLabel('here', pos);
  }

  static testError(type: ErrorType): SystemError {
    return new SystemError(type, 'test error');
  }
}
