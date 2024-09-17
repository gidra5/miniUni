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

export const PatternNodeType = {
  ...LeafNodeType,
  TUPLE: 'tuple',
  SPREAD: '...',
  MUTABLE: 'mut',
  COLON: ':',
  ATOM: 'atom',
  OBJECT: 'object',
  PARENS: 'parens',
  SQUARE_BRACKETS: 'square_brackets',
} as const;
export type PatternNodeType =
  (typeof PatternNodeType)[keyof typeof PatternNodeType];

export const TupleNodeType = {
  SPREAD: '...',
  COLON: ':',
} as const;
export type TupleNodeType = (typeof TupleNodeType)[keyof typeof TupleNodeType];

export const InfixNodeType = {
  ADD: 'add',
  PLUS: 'plus',
  SUB: 'subtract',
  MINUS: 'minus',
  DIV: '/',
  MULT: '*',
  MOD: '%',
  POW: '^',
  PARALLEL: 'parallel',
  SEND: 'send',
  COLON: ':',
  TUPLE: ',',
  NOT_EQUAL: '!=',
  EQUAL: '==',
  DEEP_EQUAL: '===',
  DEEP_NOT_EQUAL: '!==',
  AND: 'and',
  OR: 'or',
  LESS: '<',
  LESS_EQUAL: '<=',
  APPLICATION: 'application',
  SEQUENCE: 'sequence',
  SEND_STATUS: '?<-',
  GREATER: '>',
  GREATER_EQUAL: '>=',
} as const;
export type InfixNodeType = (typeof InfixNodeType)[keyof typeof InfixNodeType];

export const PrefixNodeType = {
  RECEIVE: 'receive',
  DECLARE: ':=',
  ASSIGN: '=',
  ATOM: 'atom',
  NOT: 'not',
  FUNCTION: 'func',
  IF: 'if',
  IF_ELSE: 'if_else',
  WHILE: 'while',
  IMPORT: 'import',
  DECREMENT: '--',
  INCREMENT: '++',
  EXPORT: 'export',
  RECEIVE_STATUS: '<-?',
  INC_ASSIGN: '+=',
  LOOP: 'loop',
  FOR: 'for',
  FORK: 'async',
  MATCH: 'match',
  MATCH_CASE: 'match_case',
  INJECT: 'inject',
  MASK: 'mask',
  WITHOUT: 'without',
} as const;
export type PrefixNodeType =
  (typeof PrefixNodeType)[keyof typeof PrefixNodeType];

export const ExpressionNodeType = {
  ...LeafNodeType,
  ...InfixNodeType,
  RECEIVE: 'receive',
  DECLARE: ':=',
  ASSIGN: '=',
  ATOM: 'atom',
  NOT: 'not',
  PARENS: 'parens',
  INDEX: 'index',
  SQUARE_BRACKETS: 'square_brackets',
  BLOCK: 'block',
  FUNCTION: 'func',
  IF: 'if',
  IF_ELSE: 'if_else',
  WHILE: 'while',
  IMPORT: 'import',
  POST_INCREMENT: 'post_increment',
  POST_DECREMENT: 'post_decrement',
  DECREMENT: '--',
  INCREMENT: '++',
  EXPORT: 'export',
  RECEIVE_STATUS: '<-?',
  INC_ASSIGN: '+=',
  LOOP: 'loop',
  FOR: 'for',
  FORK: 'async',
  MATCH: 'match',
  MATCH_CASE: 'match_case',
  INJECT: 'inject',
  MASK: 'mask',
  WITHOUT: 'without',
} as const;
export type ExpressionNodeType =
  (typeof ExpressionNodeType)[keyof typeof ExpressionNodeType];

export const OperatorNodeType = {
  ...ExpressionNodeType,
  SPREAD: '...',
  MUTABLE: 'mut',
} as const;
export type OperatorNodeType =
  (typeof OperatorNodeType)[keyof typeof OperatorNodeType];

export const NodeType = {
  ERROR: 'error',
  ...LeafNodeType,
  ...RootNodeType,
  ...OperatorNodeType,
} as const;
export type NodeType = (typeof NodeType)[keyof typeof NodeType];

type ScriptNode = {
  id: string;
  data: {};
  type: typeof RootNodeType.SCRIPT;
  children: ExpressionNode[];
};
type ModuleNode = {
  id: string;
  data: {};
  type: typeof RootNodeType.MODULE;
  children: ExpressionNode[];
};
type ExpressionNode = {
  id: string;
  data: {};
  type: typeof RootNodeType.MODULE;
  children: ExpressionNode[];
};

const nextId = () => {
  const id = inject(Injectable.ASTNodeNextId);
  register(Injectable.ASTNodeNextId, id + 1);
  return String(id);
};

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

const generatePrecedences = <T extends string>(
  precedenceList: [T, Fixity, Associativity?][]
) => {
  const precedences = {} as Record<T, Precedence>;

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

  return precedences;
};

// if two same operators are next to each other, which one will take precedence
// first come lower precedence operators
const exprPrecedenceList: [OperatorNodeType, Fixity, Associativity?][] = [
  // [OperatorType.SEQUENCE, Fixity.INFIX, Associativity.RIGHT],
  [OperatorNodeType.FUNCTION, Fixity.PREFIX],
  [OperatorNodeType.IF, Fixity.PREFIX],
  [OperatorNodeType.IF_ELSE, Fixity.PREFIX],
  [OperatorNodeType.LOOP, Fixity.PREFIX],
  // [OperatorType.WHILE, Fixity.PREFIX],
  // [OperatorType.FOR, Fixity.PREFIX],
  // [OperatorType.MATCH, Fixity.PREFIX],
  // [OperatorType.INJECT, Fixity.PREFIX],
  // [OperatorType.MASK, Fixity.PREFIX],
  // [OperatorType.WITHOUT, Fixity.PREFIX],

  [OperatorNodeType.DECLARE, Fixity.PREFIX],
  [OperatorNodeType.ASSIGN, Fixity.PREFIX],
  [OperatorNodeType.INC_ASSIGN, Fixity.PREFIX],

  [OperatorNodeType.FORK, Fixity.PREFIX],
  [OperatorNodeType.PARALLEL, Fixity.INFIX, Associativity.LEFT_AND_RIGHT],
  [OperatorNodeType.TUPLE, Fixity.INFIX, Associativity.LEFT_AND_RIGHT],
  [OperatorNodeType.COLON, Fixity.INFIX, Associativity.RIGHT],
  [OperatorNodeType.SPREAD, Fixity.PREFIX],

  [OperatorNodeType.SEND, Fixity.INFIX, Associativity.RIGHT],
  [OperatorNodeType.RECEIVE, Fixity.PREFIX],
  [OperatorNodeType.SEND_STATUS, Fixity.INFIX, Associativity.RIGHT],
  [OperatorNodeType.RECEIVE_STATUS, Fixity.PREFIX],

  [OperatorNodeType.OR, Fixity.INFIX, Associativity.LEFT_AND_RIGHT],
  [OperatorNodeType.AND, Fixity.INFIX, Associativity.LEFT_AND_RIGHT],
  [OperatorNodeType.EQUAL, Fixity.INFIX, Associativity.RIGHT],
  [OperatorNodeType.NOT_EQUAL, Fixity.INFIX, Associativity.RIGHT],
  [OperatorNodeType.LESS, Fixity.INFIX, Associativity.RIGHT],
  [OperatorNodeType.LESS_EQUAL, Fixity.INFIX, Associativity.RIGHT],
  [OperatorNodeType.GREATER, Fixity.INFIX, Associativity.RIGHT],
  [OperatorNodeType.GREATER_EQUAL, Fixity.INFIX, Associativity.RIGHT],
  [OperatorNodeType.NOT, Fixity.PREFIX],

  [OperatorNodeType.ADD, Fixity.INFIX, Associativity.LEFT_AND_RIGHT],
  [OperatorNodeType.SUB, Fixity.INFIX, Associativity.LEFT],
  [OperatorNodeType.MULT, Fixity.INFIX, Associativity.LEFT_AND_RIGHT],
  [OperatorNodeType.DIV, Fixity.INFIX, Associativity.LEFT],
  [OperatorNodeType.MOD, Fixity.INFIX, Associativity.LEFT],
  [OperatorNodeType.POW, Fixity.INFIX, Associativity.RIGHT],
  [OperatorNodeType.MINUS, Fixity.PREFIX],
  [OperatorNodeType.PLUS, Fixity.PREFIX],
  [OperatorNodeType.INCREMENT, Fixity.PREFIX],
  [OperatorNodeType.DECREMENT, Fixity.PREFIX],
  [OperatorNodeType.POST_INCREMENT, Fixity.POSTFIX],
  [OperatorNodeType.POST_DECREMENT, Fixity.POSTFIX],

  [OperatorNodeType.IMPORT, Fixity.PREFIX],
  [OperatorNodeType.EXPORT, Fixity.PREFIX],
  [OperatorNodeType.MUTABLE, Fixity.PREFIX],
  [OperatorNodeType.INDEX, Fixity.POSTFIX],
  [OperatorNodeType.APPLICATION, Fixity.INFIX, Associativity.LEFT],
  [OperatorNodeType.ATOM, Fixity.PREFIX],
] as const;

const patternPrecedenceList: [PatternNodeType, Fixity, Associativity?][] = [
  [PatternNodeType.TUPLE, Fixity.INFIX, Associativity.LEFT_AND_RIGHT],
  [PatternNodeType.COLON, Fixity.INFIX, Associativity.RIGHT],
  [PatternNodeType.SPREAD, Fixity.PREFIX],
  [PatternNodeType.ATOM, Fixity.PREFIX],
] as const;

const exprPrecedences = generatePrecedences(exprPrecedenceList);

const patternPrecedences = generatePrecedences(patternPrecedenceList);

export const getExprPrecedence = (operator: string): Precedence => {
  return exprPrecedences[operator] ?? [null, null];
};

export const getPatternPrecedence = (operator: string): Precedence => {
  return patternPrecedences[operator] ?? [null, null];
};

export const node = (
  type: string,
  {
    data = {},
    position,
    children = [],
  }: { data?: any; position?: Position; children?: Tree[] } = {}
): Tree => {
  const id = nextId();
  if (position) inject(Injectable.ASTNodePositionMap).set(id, position);
  return { type, id, data, children };
};

export const error = (cause: SystemError, _node: Tree | Position): Tree =>
  node(NodeType.ERROR, {
    data: { cause },
    children: 'type' in _node ? [_node] : [],
    position: isPosition(_node) ? _node : undefined,
  });

export const implicitPlaceholder = (position: Position): Tree =>
  node(NodeType.IMPLICIT_PLACEHOLDER, { position });

export const placeholder = (position: Position): Tree =>
  node(NodeType.PLACEHOLDER, { position });

export const name = (value: string | symbol, position: Position): Tree =>
  node(NodeType.NAME, { data: { value }, position });

export const number = (value: number, position: Position): Tree =>
  node(NodeType.NUMBER, { data: { value }, position });

export const string = (value: string, position: Position): Tree =>
  node(NodeType.STRING, { data: { value }, position });

const tokenError = (
  token: Extract<Token, { type: 'error' }>,
  position: Position
): Tree => node(NodeType.ERROR, { data: { cause: token.cause }, position });

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

export const module = (children: Tree[]): Tree =>
  node(NodeType.MODULE, { children });

export const script = (children: Tree[]): Tree =>
  node(NodeType.SCRIPT, { children });

export const block = (expr: Tree, position: Position): Tree =>
  node(OperatorNodeType.BLOCK, { position, children: [expr] });

export const fn = (
  pattern: Tree,
  body: Tree,
  {
    position,
    isTopFunction = true,
  }: { position?: Position; isTopFunction?: boolean } = {}
): Tree => {
  const children = [pattern, body];
  const _node = node(OperatorNodeType.FUNCTION, { position, children });
  if (!isTopFunction) _node.data.isTopFunction = isTopFunction;
  return _node;
};

export const tuple = (children: Tree[]): Tree =>
  node(OperatorNodeType.TUPLE, { children });
