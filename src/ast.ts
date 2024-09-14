import { SystemError } from './error.js';
import { inject, Injectable, register } from './injector.js';
import { mergePositions, Position } from './position.js';
import { Token } from './tokens.js';
import { inspect } from './utils.js';

export type AbstractSyntaxTree<T = any> = {
  type: string;
  id: string;
  data: T;
  children: AbstractSyntaxTree<T>[];
};
export type Precedence = [prefix: number | null, postfix: number | null];

export enum NodeType {
  ERROR = 'error',
  IMPLICIT_PLACEHOLDER = 'implicit_placeholder',
  PLACEHOLDER = 'placeholder',
  NAME = 'name',
  NUMBER = 'number',
  STRING = 'string',
  OPERATOR = 'operator',
  SCRIPT = 'script',
  MODULE = 'module',
}

const nextId = () => {
  const id = inject(Injectable.ASTNodeNextId);
  register(Injectable.ASTNodeNextId, id + 1);
  return String(id);
};

export const error = (
  cause: SystemError,
  node: AbstractSyntaxTree | Position
): AbstractSyntaxTree => ({
  type: NodeType.ERROR,
  id: nextId(),
  data: {
    cause,
    get position() {
      return 'type' in node ? node?.data.position : node;
    },
  },
  children: 'type' in node ? [node] : [],
});

export const implicitPlaceholder = (
  position: Position
): AbstractSyntaxTree => ({
  type: NodeType.IMPLICIT_PLACEHOLDER,
  id: nextId(),
  data: { position },
  children: [],
});

export const placeholder = (position: Position): AbstractSyntaxTree => ({
  type: NodeType.PLACEHOLDER,
  id: nextId(),
  data: { position },
  children: [],
});

export const name = (
  value: string | symbol,
  position: Position
): AbstractSyntaxTree => ({
  type: NodeType.NAME,
  id: nextId(),
  data: { value, position },
  children: [],
});

export const number = (
  value: number,
  position: Position
): AbstractSyntaxTree => ({
  type: NodeType.NUMBER,
  id: nextId(),
  data: { value, position },
  children: [],
});

export const string = (
  value: string,
  position: Position
): AbstractSyntaxTree => ({
  type: NodeType.STRING,
  id: nextId(),
  data: { value, position },
  children: [],
});

const tokenError = (
  token: Extract<Token, { type: 'error' }>,
  position: Position
): AbstractSyntaxTree => ({
  type: NodeType.ERROR,
  id: nextId(),
  data: { cause: token.cause, position },
  children: [],
});

export const token = (token: Token, position: Position): AbstractSyntaxTree =>
  token.type === 'number'
    ? number(token.value, position)
    : token.type === 'string'
    ? string(token.value, position)
    : token.type === 'placeholder'
    ? placeholder(position)
    : token.type === 'error'
    ? tokenError(token, position)
    : name(token.src, position);

export enum OperatorType {
  ADD = 'add',
  PLUS = 'plus',
  SUB = 'subtract',
  MINUS = 'minus',
  DIV = '/',
  MULT = '*',
  MOD = '%',
  POW = '^',
  PARALLEL = 'parallel',
  RECEIVE = 'receive',
  SEND = 'send',
  DECLARE = ':=',
  ASSIGN = '=',
  ATOM = 'atom',
  COLON = ':',
  TUPLE = ',',
  SPREAD = '...',
  NOT = 'not',
  NOT_EQUAL = '!=',
  EQUAL = '==',
  DEEP_EQUAL = '===',
  DEEP_NOT_EQUAL = '!==',
  AND = 'and',
  OR = 'or',
  LESS = '<',
  LESS_EQUAL = '<=',
  APPLICATION = 'application',
  PARENS = 'parens',
  OBJECT = 'object',
  INDEX = 'index',
  SQUARE_BRACKETS = 'square_brackets',
  SEQUENCE = 'sequence',
  BLOCK = 'block',
  FUNCTION = 'func',
  IF = 'if',
  IF_ELSE = 'if_else',
  WHILE = 'while',
  TOKEN = 'token',
  IMPORT = 'import',
  POST_INCREMENT = 'post_increment',
  POST_DECREMENT = 'post_decrement',
  DECREMENT = '--',
  INCREMENT = '++',
  EXPORT = 'export',
  RECEIVE_STATUS = '<-?',
  SEND_STATUS = '?<-',
  INC_ASSIGN = '+=',
  LOOP = 'loop',
  FOR = 'for',
  ASYNC = 'async',
  MATCH = 'match',
  MATCH_CASE = 'match_case',
  INJECT = 'inject',
  MASK = 'mask',
  WITHOUT = 'without',
  GREATER = '>',
  GREATER_EQUAL = '>=',
  MUTABLE = 'mut',
}

enum Associativity {
  LEFT = 'left',
  RIGHT = 'right',
  LEFT_AND_RIGHT = 'both',
}

enum Fixity {
  PREFIX = 'prefix',
  POSTFIX = 'postfix',
  INFIX = 'infix',
  NONE = 'none',
}

// if two same operators are next to each other, which one will take precedence
// first come lower precedence operators
// const semicolonPrecedence = [
const precedenceList: [OperatorType, Fixity, Associativity?][] = [
  [OperatorType.SEQUENCE, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.FUNCTION, Fixity.PREFIX],
  [OperatorType.IF, Fixity.PREFIX],
  [OperatorType.IF_ELSE, Fixity.PREFIX],
  [OperatorType.LOOP, Fixity.PREFIX],
  [OperatorType.WHILE, Fixity.PREFIX],
  [OperatorType.FOR, Fixity.PREFIX],
  [OperatorType.MATCH, Fixity.PREFIX],
  [OperatorType.MATCH_CASE, Fixity.PREFIX],
  [OperatorType.INJECT, Fixity.PREFIX],
  [OperatorType.MASK, Fixity.PREFIX],
  [OperatorType.WITHOUT, Fixity.PREFIX],
  [OperatorType.PARALLEL, Fixity.INFIX, Associativity.LEFT_AND_RIGHT],
  [OperatorType.ASYNC, Fixity.PREFIX],
  // ] as const;

  // const assignmentPrecedence = [
  [OperatorType.DECLARE, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.ASSIGN, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.INC_ASSIGN, Fixity.INFIX, Associativity.RIGHT],
  // ] as const;

  // const tuplePrecedence = [
  [OperatorType.TUPLE, Fixity.INFIX, Associativity.LEFT_AND_RIGHT],
  [OperatorType.COLON, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.SPREAD, Fixity.PREFIX],

  [OperatorType.SEND, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.RECEIVE, Fixity.PREFIX],
  [OperatorType.SEND_STATUS, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.RECEIVE_STATUS, Fixity.PREFIX],
  // ] as const;

  // const booleanPrecedence = [
  [OperatorType.OR, Fixity.INFIX, Associativity.LEFT_AND_RIGHT],
  [OperatorType.AND, Fixity.INFIX, Associativity.LEFT_AND_RIGHT],
  [OperatorType.EQUAL, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.NOT_EQUAL, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.LESS, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.LESS_EQUAL, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.GREATER, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.GREATER_EQUAL, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.NOT, Fixity.PREFIX],
  // ] as const;

  // const arithmeticPrecedence = [
  [OperatorType.ADD, Fixity.INFIX, Associativity.LEFT_AND_RIGHT],
  [OperatorType.SUB, Fixity.INFIX, Associativity.LEFT],
  [OperatorType.MULT, Fixity.INFIX, Associativity.LEFT_AND_RIGHT],
  [OperatorType.DIV, Fixity.INFIX, Associativity.LEFT],
  [OperatorType.MOD, Fixity.INFIX, Associativity.LEFT],
  [OperatorType.POW, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.MINUS, Fixity.PREFIX],
  [OperatorType.PLUS, Fixity.PREFIX],
  [OperatorType.INCREMENT, Fixity.PREFIX],
  [OperatorType.DECREMENT, Fixity.PREFIX],
  [OperatorType.POST_INCREMENT, Fixity.POSTFIX],
  [OperatorType.POST_DECREMENT, Fixity.POSTFIX],
  // ] as const;

  // const topPrecedence = [
  [OperatorType.IMPORT, Fixity.PREFIX],
  [OperatorType.EXPORT, Fixity.PREFIX],
  [OperatorType.MUTABLE, Fixity.PREFIX],
  [OperatorType.INDEX, Fixity.POSTFIX],
  [OperatorType.APPLICATION, Fixity.INFIX, Associativity.LEFT],
  [OperatorType.ATOM, Fixity.PREFIX],
] as const;

// if two same operators are next to each other, which one will take precedence
// left associative - left one will take precedence
// right associative - right one will take precedence
// associative - does not matter, can be grouped in any order
const leftAssociative = (precedence: number): Precedence => [
  precedence,
  precedence + 1,
];
const rightAssociative = (precedence: number): Precedence => [
  precedence + 1,
  precedence,
];
const associative = (precedence: number): Precedence => [
  precedence,
  precedence,
];

const precedences = (() => {
  const precedences = {};

  const leftAssociative = (p: number): Precedence => [p, p + 1];
  const rightAssociative = (p: number): Precedence => [p + 1, p];
  const associative = (p: number): Precedence => [p, p];
  let precedenceCounter = 0;

  for (const [operator, fixity, associativity] of precedenceList) {
    precedenceCounter++;

    if (fixity === Fixity.PREFIX) {
      precedences[operator] = [null, precedenceCounter];
    } else if (fixity === Fixity.POSTFIX) {
      precedences[operator] = [precedenceCounter, null];
    } else if (fixity === Fixity.NONE) {
      precedences[operator] = [null, null];
    } else if (associativity === Associativity.LEFT_AND_RIGHT) {
      precedences[operator] = associative(precedenceCounter);
    } else if (associativity === Associativity.LEFT) {
      precedences[operator] = leftAssociative(precedenceCounter++);
    } else precedences[operator] = rightAssociative(precedenceCounter++);
  }

  return precedences as Record<OperatorType, Precedence>;
})();

export const getPrecedence = (operator: string | symbol): Precedence => {
  const semicolonPrecedence = 1;
  const assignmentPrecedence = semicolonPrecedence + 1;
  const tuplePrecedence = assignmentPrecedence + 4;
  const booleanPrecedence = tuplePrecedence + 2;
  const arithmeticPrecedence = booleanPrecedence + 3;
  switch (operator) {
    case OperatorType.INCREMENT:
      return [null, 3];
    case OperatorType.DECREMENT:
      return [null, 3];
    case OperatorType.POST_DECREMENT:
      return [3, null];
    case OperatorType.POST_INCREMENT:
      return [3, null];

    case OperatorType.IMPORT:
      return [null, 1];
    case OperatorType.EXPORT:
      return [null, 1];
    case OperatorType.MUTABLE:
      return [null, 1];

    case OperatorType.DECLARE:
      return [null, 1];
    case OperatorType.INC_ASSIGN:
    case OperatorType.ASSIGN:
      return [null, 1];
    case OperatorType.PARENS:
      return [null, null];
    case OperatorType.SEQUENCE:
      return [null, null];
    // return rightAssociative(semicolonPrecedence);

    case OperatorType.TUPLE:
      return associative(tuplePrecedence);
    case OperatorType.SPREAD:
      return [null, tuplePrecedence + 1];
    case OperatorType.COLON:
      return rightAssociative(tuplePrecedence + 1);
    case OperatorType.FUNCTION:
      return [null, 2];
    case OperatorType.IF:
      return [null, 2];
    case OperatorType.IF_ELSE:
      return [null, 2];
    case OperatorType.LOOP:
      return [null, 2];

    case OperatorType.OR:
      return associative(booleanPrecedence);
    case OperatorType.AND:
      return associative(booleanPrecedence + 1);
    case OperatorType.EQUAL:
      return rightAssociative(booleanPrecedence + 2);
    case OperatorType.NOT_EQUAL:
      return rightAssociative(booleanPrecedence + 2);
    case OperatorType.LESS:
      return rightAssociative(booleanPrecedence + 4);
    case OperatorType.LESS_EQUAL:
      return rightAssociative(booleanPrecedence + 4);
    case OperatorType.GREATER:
      return rightAssociative(booleanPrecedence + 4);
    case OperatorType.GREATER_EQUAL:
      return rightAssociative(booleanPrecedence + 4);
    case OperatorType.NOT:
      return [null, booleanPrecedence + 5];

    case OperatorType.PARALLEL:
      return associative(assignmentPrecedence + 1);
    case OperatorType.ASYNC:
      return [null, assignmentPrecedence + 1];
    case OperatorType.SEND:
      return rightAssociative(tuplePrecedence + 2);
    case OperatorType.RECEIVE:
      return [null, tuplePrecedence + 2];
    case OperatorType.SEND_STATUS:
      return rightAssociative(tuplePrecedence + 2);
    case OperatorType.RECEIVE_STATUS:
      return [null, tuplePrecedence + 2];

    case OperatorType.ADD:
    case OperatorType.SUB:
    case OperatorType.MULT:
    case OperatorType.DIV:
    case OperatorType.MOD:
    case OperatorType.POW:
    case OperatorType.MINUS:
    case OperatorType.PLUS:
    case OperatorType.ATOM:
    case OperatorType.APPLICATION:
    case OperatorType.INDEX:
      return precedences[operator];
    default:
      return [null, null];
  }
};

export const operator = (
  operator: string | symbol,
  position: Position,
  ...children: AbstractSyntaxTree[]
): AbstractSyntaxTree => {
  const id = nextId();
  const data = { operator, position };
  return { type: NodeType.OPERATOR, id, data, children };
};

export const module = (children: AbstractSyntaxTree[]): AbstractSyntaxTree => ({
  type: NodeType.MODULE,
  id: nextId(),
  data: {},
  children,
});

export const script = (children: AbstractSyntaxTree[]): AbstractSyntaxTree => ({
  type: NodeType.SCRIPT,
  id: nextId(),
  data: {},
  children,
});

export const block = (
  sequence: AbstractSyntaxTree,
  position: Position = sequence.data.position
): AbstractSyntaxTree => operator(OperatorType.BLOCK, position, sequence);

export const fn = (
  pattern: AbstractSyntaxTree,
  body: AbstractSyntaxTree,
  {
    position = mergePositions(pattern.data.position, body.data.position),
    isTopFunction = true,
  }: { position?: Position; isTopFunction?: boolean } = {}
): AbstractSyntaxTree => {
  const node = operator(OperatorType.FUNCTION, position, pattern, body);
  if (!isTopFunction) node.data.isTopFunction = isTopFunction;
  return node;
};

export const tuple = (
  children: AbstractSyntaxTree[],
  position: Position = mergePositions(
    ...children.map((child) => child.data.position)
  )
): AbstractSyntaxTree => operator(OperatorType.TUPLE, position, ...children);
