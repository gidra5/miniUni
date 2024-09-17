import { SystemError } from './error.js';
import { inject, Injectable, register } from './injector.js';
import { isPosition, Position } from './position.js';
import { Token } from './tokens.js';

export type Tree = {
  type: string;
  id: string;
  data: any;
  children: Tree[];
};
export type Precedence = [prefix: number | null, postfix: number | null];

const LeafNodeType = {
  IMPLICIT_PLACEHOLDER: 'implicit_placeholder',
  PLACEHOLDER: 'placeholder',
  NAME: 'name',
  NUMBER: 'number',
  STRING: 'string',
} as const;
type LeafNodeType = (typeof LeafNodeType)[keyof typeof LeafNodeType];

const RootNodeType = {
  SCRIPT: 'script',
  MODULE: 'module',
} as const;
type RootNodeType = (typeof RootNodeType)[keyof typeof RootNodeType];

export const OperatorType = {
  ADD: 'add',
  PLUS: 'plus',
  SUB: 'subtract',
  MINUS: 'minus',
  DIV: '/',
  MULT: '*',
  MOD: '%',
  POW: '^',
  PARALLEL: 'parallel',
  RECEIVE: 'receive',
  SEND: 'send',
  DECLARE: ':=',
  ASSIGN: '=',
  ATOM: 'atom',
  COLON: ':',
  TUPLE: ',',
  SPREAD: '...',
  NOT: 'not',
  NOT_EQUAL: '!=',
  EQUAL: '==',
  DEEP_EQUAL: '===',
  DEEP_NOT_EQUAL: '!==',
  AND: 'and',
  OR: 'or',
  LESS: '<',
  LESS_EQUAL: '<=',
  APPLICATION: 'application',
  PARENS: 'parens',
  OBJECT: 'object',
  INDEX: 'index',
  SQUARE_BRACKETS: 'square_brackets',
  SEQUENCE: 'sequence',
  BLOCK: 'block',
  FUNCTION: 'func',
  IF: 'if',
  IF_ELSE: 'if_else',
  WHILE: 'while',
  TOKEN: 'token',
  IMPORT: 'import',
  POST_INCREMENT: 'post_increment',
  POST_DECREMENT: 'post_decrement',
  DECREMENT: '--',
  INCREMENT: '++',
  EXPORT: 'export',
  RECEIVE_STATUS: '<-?',
  SEND_STATUS: '?<-',
  INC_ASSIGN: '+=',
  LOOP: 'loop',
  FOR: 'for',
  FORK: 'async',
  MATCH: 'match',
  MATCH_CASE: 'match_case',
  INJECT: 'inject',
  MASK: 'mask',
  WITHOUT: 'without',
  GREATER: '>',
  GREATER_EQUAL: '>=',
  MUTABLE: 'mut',
} as const;
export type OperatorType = (typeof OperatorType)[keyof typeof OperatorType];

export const NodeType = {
  ERROR: 'error',
  ...LeafNodeType,
  ...RootNodeType,
  ...OperatorType,
} as const;
export type NodeType = (typeof NodeType)[keyof typeof NodeType];

const nextId = () => {
  const id = inject(Injectable.ASTNodeNextId);
  register(Injectable.ASTNodeNextId, id + 1);
  return String(id);
};

export const error = (cause: SystemError, node: Tree | Position): Tree => {
  const id = nextId();

  if (isPosition(node)) inject(Injectable.ASTNodePositionMap).set(id, node);

  return {
    type: NodeType.ERROR,
    id,
    data: { cause },
    children: 'type' in node ? [node] : [],
  };
};

export const implicitPlaceholder = (position: Position): Tree => {
  const id = nextId();
  inject(Injectable.ASTNodePositionMap).set(id, position);
  return {
    type: NodeType.IMPLICIT_PLACEHOLDER,
    id,
    data: {},
    children: [],
  };
};

export const placeholder = (position: Position): Tree => {
  const id = nextId();
  inject(Injectable.ASTNodePositionMap).set(id, position);
  return {
    type: NodeType.PLACEHOLDER,
    id,
    data: {},
    children: [],
  };
};

export const name = (value: string | symbol, position: Position): Tree => {
  const id = nextId();
  inject(Injectable.ASTNodePositionMap).set(id, position);
  return {
    type: NodeType.NAME,
    id,
    data: { value },
    children: [],
  };
};

export const number = (value: number, position: Position): Tree => {
  const id = nextId();
  inject(Injectable.ASTNodePositionMap).set(id, position);
  return {
    type: NodeType.NUMBER,
    id,
    data: { value },
    children: [],
  };
};

export const string = (value: string, position: Position): Tree => {
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
): Tree => {
  const id = nextId();
  inject(Injectable.ASTNodePositionMap).set(id, position);
  return {
    type: NodeType.ERROR,
    id,
    data: { cause: token.cause },
    children: [],
  };
};

export const token = (token: Token, position: Position): Tree =>
  token.type === 'number'
    ? number(token.value, position)
    : token.type === 'string'
    ? string(token.value, position)
    : token.type === 'placeholder'
    ? placeholder(position)
    : token.type === 'error'
    ? tokenError(token, position)
    : name(token.src, position);

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

export const getPrecedence = (operator: string): Precedence => {
  return precedences[operator] ?? [null, null];
};

export const operator = (
  type: string,
  { position, children = [] }: { position?: Position; children?: Tree[] } = {}
): Tree => {
  const id = nextId();
  if (position) inject(Injectable.ASTNodePositionMap).set(id, position);
  return { type, id, data: {}, children };
};

export const module = (children: Tree[]): Tree =>
  operator(NodeType.MODULE, { children });

export const script = (children: Tree[]): Tree =>
  operator(NodeType.SCRIPT, { children });

export const block = (expr: Tree, position: Position): Tree =>
  operator(OperatorType.BLOCK, { position, children: [expr] });

export const fn = (
  pattern: Tree,
  body: Tree,
  {
    position,
    isTopFunction = true,
  }: { position?: Position; isTopFunction?: boolean } = {}
): Tree => {
  const children = [pattern, body];
  const _node = operator(OperatorType.FUNCTION, { position, children });
  if (!isTopFunction) _node.data.isTopFunction = isTopFunction;
  return _node;
};

export const tuple = (children: Tree[]): Tree =>
  operator(OperatorType.TUPLE, { children });
