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

export const OperatorNodeType = {
  IMPLICIT_PLACEHOLDER: 'implicit_placeholder',
  PLACEHOLDER: 'placeholder',
  NAME: 'name',
  NUMBER: 'number',
  STRING: 'string',
  ATOM: 'atom',

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

  RECEIVE: 'receive',
  DECLARE: ':=',
  ASSIGN: '=',
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

  SPREAD: '...',
  MUTABLE: 'mut',
} as const;
export type OperatorNodeType =
  (typeof OperatorNodeType)[keyof typeof OperatorNodeType];

export const NodeType = {
  ERROR: 'error',

  ...OperatorNodeType,

  SCRIPT: 'script',
  MODULE: 'module',

  RECORD: 'object',
} as const;
export type NodeType = (typeof NodeType)[keyof typeof NodeType];

type ScriptNode = {
  id: string;
  data: {};
  type: typeof NodeType.SCRIPT;
  children: ExpressionNode[];
};
export type ModuleNode = {
  id: string;
  data: {};
  type: typeof NodeType.MODULE;
  children: [
    ...(ImportNode | ErrorNode | DeclarationPatternNode)[],
    ...([ExportNode] | [])
  ];
};
export type DeclarationPatternNode = {
  id: string;
  data: {};
  type: typeof NodeType.DECLARE;
  children: [ExportPatternNode, ExpressionNode];
};
export type ImportNode = {
  id: string;
  data: { name: string };
  type: typeof NodeType.IMPORT;
  children: [PatternNode];
};
export type ExportNode = {
  id: string;
  data: {};
  type: typeof NodeType.EXPORT;
  children: [ExpressionNode];
};
type ExportPatternNode = PatternNode;

export type ExpressionNode =
  | ErrorNode
  | ImplicitPlaceholderNode
  | PlaceholderNode
  | NameNode
  | NumberNode
  | StringNode
  | AtomNode
  | BlockNode
  | SequenceNode
  | VariableNode
  | MatchNode
  | FunctionNode
  | TupleNode;
export type ErrorNode = {
  id: string;
  data: { cause: SystemError };
  type: typeof NodeType.ERROR;
  children: [Tree] | [];
};
type ImplicitPlaceholderNode = {
  id: string;
  data: {};
  type: typeof NodeType.IMPLICIT_PLACEHOLDER;
  children: [];
};
type PlaceholderNode = {
  id: string;
  data: {};
  type: typeof NodeType.PLACEHOLDER;
  children: [];
};
type NameNode = {
  id: string;
  data: { value: string | symbol };
  type: typeof NodeType.NAME;
  children: [];
};
type NumberNode = {
  id: string;
  data: { value: number };
  type: typeof NodeType.NUMBER;
  children: [];
};
type StringNode = {
  id: string;
  data: { value: string };
  type: typeof NodeType.STRING;
  children: [];
};
type AtomNode = {
  id: string;
  data: { name: string };
  type: typeof NodeType.ATOM;
  children: [];
};

type BlockNode = {
  id: string;
  data: {};
  type: typeof NodeType.BLOCK;
  children: [ExpressionNode];
};
type SequenceNode = {
  id: string;
  data: {};
  type: typeof NodeType.SEQUENCE;
  children: ExpressionNode[];
};
type VariableNode = {
  id: string;
  data: { assert: boolean };
  type: typeof NodeType.DECLARE;
  children: [MatchPatternNode, ExpressionNode];
};
type TupleNode = {
  id: string;
  data: {};
  type: typeof NodeType.TUPLE;
  children: ExpressionNode[];
};
type MatchNode = {
  id: string;
  data: {};
  type: typeof NodeType.MATCH;
  children: [ExpressionNode, ...MatchCaseNode[]];
};
type MatchCaseNode = {
  id: string;
  data: {};
  type: typeof NodeType.MATCH_CASE;
  children: [MatchPatternNode, ExpressionNode];
};
type FunctionNode = {
  id: string;
  data: { isTopFunction?: false };
  type: typeof NodeType.FUNCTION;
  children: [MatchPatternNode, ExpressionNode];
};

type PatternNode =
  | ExpressionNode
  | RecordPatternNode
  | TuplePatternNode
  | PlaceholderNode
  | NameNode
  | StringNode
  | NumberNode
  | AtomNode;
type PatternWithDefaultNode = {
  id: string;
  data: {};
  type: typeof NodeType.EQUAL;
  children: [MatchPatternNode, ExpressionNode];
};
type MatchPatternNode = MutablePatternNode | PatternNode;

type MutablePatternNode = {
  id: string;
  data: {};
  type: typeof NodeType.MUTABLE;
  children: [PatternWithDefaultNode];
};

type TuplePatternNode = {
  id: string;
  data: {};
  type: typeof NodeType.TUPLE;
  children: [
    ...([SpreadPatternNode] | []),
    ...PatternWithDefaultNode[],
    ...([SpreadPatternNode] | [])
  ];
};
type RecordPatternNode = {
  id: string;
  data: {};
  type: typeof NodeType.RECORD;
  children: [
    ...(RecordNameWithDefaultNode | NameNode | RecordRenamePatternNode)[],
    ...([SpreadPatternNode] | [])
  ];
};
type RecordNameWithDefaultNode = {
  id: string;
  data: {};
  type: typeof NodeType.COLON;
  children: [NameNode, ExpressionNode];
};
type SpreadPatternNode = {
  id: string;
  data: {};
  type: typeof NodeType.SPREAD;
  children: [MatchPatternNode];
};
type RecordRenamePatternNode = {
  id: string;
  data: {};
  type: typeof NodeType.COLON;
  children: [NameNode | ExpressionNode, PatternWithDefaultNode];
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

const patternPrecedenceList: [NodeType, Fixity, Associativity?][] = [
  [NodeType.TUPLE, Fixity.INFIX, Associativity.LEFT_AND_RIGHT],
  [NodeType.COLON, Fixity.INFIX, Associativity.RIGHT],
  [NodeType.SPREAD, Fixity.PREFIX],
  [NodeType.ATOM, Fixity.PREFIX],
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

export const error = (cause: SystemError, _node: Tree | Position): ErrorNode =>
  node(NodeType.ERROR, {
    data: { cause },
    children: 'type' in _node ? [_node] : [],
    position: isPosition(_node) ? _node : undefined,
  }) as ErrorNode;

export const implicitPlaceholder = (
  position: Position
): ImplicitPlaceholderNode =>
  node(NodeType.IMPLICIT_PLACEHOLDER, { position }) as ImplicitPlaceholderNode;

export const placeholder = (position: Position): PlaceholderNode =>
  node(NodeType.PLACEHOLDER, { position }) as PlaceholderNode;

export const name = (value: string | symbol, position: Position): NameNode =>
  node(NodeType.NAME, { data: { value }, position }) as NameNode;

export const number = (value: number, position: Position): NumberNode =>
  node(NodeType.NUMBER, { data: { value }, position }) as NumberNode;

export const string = (value: string, position: Position): StringNode =>
  node(NodeType.STRING, { data: { value }, position }) as StringNode;

export const token = (token: Token, position: Position) =>
  token.type === 'number'
    ? number(token.value, position)
    : token.type === 'string'
    ? string(token.value, position)
    : token.type === 'placeholder'
    ? placeholder(position)
    : token.type === 'error'
    ? error(token.cause, position)
    : name(token.src, position);

export const atom = (name: string): AtomNode =>
  node(NodeType.ATOM, { data: { name } }) as AtomNode;

export const module = (children: ModuleNode['children']): ModuleNode =>
  node(NodeType.MODULE, { children }) as ModuleNode;

export const script = (children: ScriptNode['children']): ScriptNode =>
  node(NodeType.SCRIPT, { children }) as ScriptNode;

export const block = (expr: Tree, position: Position): BlockNode =>
  node(NodeType.BLOCK, { position, children: [expr] }) as BlockNode;

export const sequence = (children: ExpressionNode[]): SequenceNode =>
  node(NodeType.SEQUENCE, { children }) as SequenceNode;

export const fn = (
  pattern: Tree,
  body: Tree,
  {
    position,
    isTopFunction = true,
  }: { position?: Position; isTopFunction?: boolean } = {}
): FunctionNode => {
  const children = [pattern, body];
  const _node = node(NodeType.FUNCTION, { position, children }) as FunctionNode;
  if (!isTopFunction) _node.data.isTopFunction = isTopFunction;
  return _node;
};

export const tuple = (children: Tree[]): TupleNode =>
  node(NodeType.TUPLE, { children }) as TupleNode;
