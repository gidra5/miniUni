import { SystemError } from './error.js';
import { inject, Injectable, register } from './injector.js';
import { isPosition, Position } from './position.js';
import { Token } from './tokens.js';

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
): AbstractSyntaxTree => {
  const id = nextId();

  if (isPosition(node)) inject(Injectable.ASTNodePositionMap).set(id, node);

  return {
    type: NodeType.ERROR,
    id,
    data: { cause },
    children: 'type' in node ? [node] : [],
  };
};

export const implicitPlaceholder = (position: Position): AbstractSyntaxTree => {
  const id = nextId();
  inject(Injectable.ASTNodePositionMap).set(id, position);
  return {
    type: NodeType.IMPLICIT_PLACEHOLDER,
    id,
    data: {},
    children: [],
  };
};

export const placeholder = (position: Position): AbstractSyntaxTree => {
  const id = nextId();
  inject(Injectable.ASTNodePositionMap).set(id, position);
  return {
    type: NodeType.PLACEHOLDER,
    id,
    data: {},
    children: [],
  };
};

export const name = (
  value: string | symbol,
  position: Position
): AbstractSyntaxTree => {
  const id = nextId();
  inject(Injectable.ASTNodePositionMap).set(id, position);
  return {
    type: NodeType.NAME,
    id,
    data: { value },
    children: [],
  };
};

export const number = (
  value: number,
  position: Position
): AbstractSyntaxTree => {
  const id = nextId();
  inject(Injectable.ASTNodePositionMap).set(id, position);
  return {
    type: NodeType.NUMBER,
    id,
    data: { value },
    children: [],
  };
};

export const string = (
  value: string,
  position: Position
): AbstractSyntaxTree => {
  const id = nextId();
  inject(Injectable.ASTNodePositionMap).set(id, position);
  return {
    type: NodeType.STRING,
    id,
    data: { value },
    children: [],
  };
};

const tokenError = (
  token: Extract<Token, { type: 'error' }>,
  position: Position
): AbstractSyntaxTree => {
  const id = nextId();
  inject(Injectable.ASTNodePositionMap).set(id, position);
  return {
    type: NodeType.ERROR,
    id,
    data: { cause: token.cause },
    children: [],
  };
};

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
  FORK = 'async',
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
  // [OperatorType.SEQUENCE, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.FUNCTION, Fixity.PREFIX],
  [OperatorType.IF, Fixity.PREFIX],
  [OperatorType.IF_ELSE, Fixity.PREFIX],
  [OperatorType.LOOP, Fixity.PREFIX],
  // [OperatorType.WHILE, Fixity.PREFIX],
  // [OperatorType.FOR, Fixity.PREFIX],
  // [OperatorType.MATCH, Fixity.PREFIX],
  // [OperatorType.INJECT, Fixity.PREFIX],
  // [OperatorType.MASK, Fixity.PREFIX],
  // [OperatorType.WITHOUT, Fixity.PREFIX],

  [OperatorType.DECLARE, Fixity.PREFIX],
  [OperatorType.ASSIGN, Fixity.PREFIX],
  [OperatorType.INC_ASSIGN, Fixity.PREFIX],

  [OperatorType.FORK, Fixity.PREFIX],
  [OperatorType.PARALLEL, Fixity.INFIX, Associativity.LEFT_AND_RIGHT],
  [OperatorType.TUPLE, Fixity.INFIX, Associativity.LEFT_AND_RIGHT],
  [OperatorType.COLON, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.SPREAD, Fixity.PREFIX],

  [OperatorType.SEND, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.RECEIVE, Fixity.PREFIX],
  [OperatorType.SEND_STATUS, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.RECEIVE_STATUS, Fixity.PREFIX],

  [OperatorType.OR, Fixity.INFIX, Associativity.LEFT_AND_RIGHT],
  [OperatorType.AND, Fixity.INFIX, Associativity.LEFT_AND_RIGHT],
  [OperatorType.EQUAL, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.NOT_EQUAL, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.LESS, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.LESS_EQUAL, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.GREATER, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.GREATER_EQUAL, Fixity.INFIX, Associativity.RIGHT],
  [OperatorType.NOT, Fixity.PREFIX],

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

  [OperatorType.IMPORT, Fixity.PREFIX],
  [OperatorType.EXPORT, Fixity.PREFIX],
  [OperatorType.MUTABLE, Fixity.PREFIX],
  [OperatorType.INDEX, Fixity.POSTFIX],
  [OperatorType.APPLICATION, Fixity.INFIX, Associativity.LEFT],
  [OperatorType.ATOM, Fixity.PREFIX],
] as const;

const precedences = (() => {
  const precedences = {};

  // if two same operators are next to each other, which one will take precedence
  // left associative - left one will take precedence
  // right associative - right one will take precedence
  // associative - does not matter, can be grouped in any order
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
  return precedences[operator] ?? [null, null];
};

export const operator = (
  operator: string | symbol,
  {
    position,
    children = [],
  }: { position?: Position; children?: AbstractSyntaxTree[] } = {}
): AbstractSyntaxTree => {
  const id = nextId();
  const data = { operator };
  if (position) inject(Injectable.ASTNodePositionMap).set(id, position);
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
  expr: AbstractSyntaxTree,
  position: Position
): AbstractSyntaxTree =>
  operator(OperatorType.BLOCK, { position, children: [expr] });

export const fn = (
  pattern: AbstractSyntaxTree,
  body: AbstractSyntaxTree,
  {
    position,
    isTopFunction = true,
  }: { position?: Position; isTopFunction?: boolean } = {}
): AbstractSyntaxTree => {
  const node = operator(OperatorType.FUNCTION, {
    position,
    children: [pattern, body],
  });
  if (!isTopFunction) node.data.isTopFunction = isTopFunction;
  return node;
};

export const tuple = (children: AbstractSyntaxTree[]): AbstractSyntaxTree =>
  operator(OperatorType.TUPLE, { children });
