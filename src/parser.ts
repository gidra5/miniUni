import type { Token } from './tokens';
import { SystemError } from './error';
import { assert } from './utils';

export type AbstractSyntaxTree<T = any> = {
  name: string;
  data: T;
  children: AbstractSyntaxTree<T>[];
};
export type Precedence = [prefix: number | null, postfix: number | null];

export const error = (
  cause: SystemError,
  node?: AbstractSyntaxTree
): AbstractSyntaxTree => ({
  name: 'error',
  data: { cause },
  children: node ? [node] : [],
});

export const implicitPlaceholder = (): AbstractSyntaxTree => ({
  name: 'implicit_placeholder',
  data: {},
  children: [],
});

export const placeholder = (): AbstractSyntaxTree => ({
  name: 'placeholder',
  data: {},
  children: [],
});

export const name = (value: string | symbol): AbstractSyntaxTree => ({
  name: 'name',
  data: { value },
  children: [],
});

export const number = (value: number): AbstractSyntaxTree => ({
  name: 'number',
  data: { value },
  children: [],
});

export const string = (value: string): AbstractSyntaxTree => ({
  name: 'string',
  data: { value },
  children: [],
});

export const token = (token: Token): AbstractSyntaxTree =>
  token.type === 'number'
    ? number(token.value)
    : token.type === 'string'
    ? string(token.value)
    : token.type === 'placeholder'
    ? placeholder()
    : token.type === 'error'
    ? error(token.cause)
    : name(token.src);

export const operator = (
  operator: string | symbol,
  ...children: AbstractSyntaxTree[]
): AbstractSyntaxTree => ({
  name: 'operator',
  data: { operator },
  children,
});

export const infix = (
  group: AbstractSyntaxTree,
  lhs: AbstractSyntaxTree,
  rhs: AbstractSyntaxTree
): AbstractSyntaxTree => {
  const {
    data: { operator },
    children,
  } = group;
  return operator(operator, lhs, ...children, rhs);
};

export const postfix = (
  group: AbstractSyntaxTree,
  lhs: AbstractSyntaxTree
): AbstractSyntaxTree => {
  const {
    data: { operator },
    children,
  } = group;
  return operator(operator, lhs, ...children);
};

export const prefix = (
  group: AbstractSyntaxTree,
  rhs: AbstractSyntaxTree
): AbstractSyntaxTree => {
  const {
    data: { operator },
    children,
  } = group;
  return operator(operator, ...children, rhs);
};

const script = (children: AbstractSyntaxTree[]): AbstractSyntaxTree => ({
  name: 'script',
  data: {},
  children,
});

enum OperatorType {
  ADD = '+',
  PLUS = '+',
  SUB = '-',
  MINUS = '-',
  DIV = '/',
  MULT = '*',
  MOD = '%',
  PARALLEL = '|',
  DECLARE = ':=',
  ASSIGN = '=',
  TUPLE = ',',
  SPREAD = '...',
  NOT = 'not',
  NOT_EQUAL = '!=',
  EQUAL = '==',
  APPLICATION = 'application',
  PARENS = 'parens',
  INDEX = 'index',
  BLOCK = 'block',
  FUNCTION = 'func',
  IF = 'if',
  LEAF = 'leaf',
}

const getPrecedence = (operator: OperatorType): Precedence => {
  const maxPrecedence = Number.MAX_SAFE_INTEGER;
  switch (operator) {
    case OperatorType.PARENS:
      return [maxPrecedence, 0];
    case OperatorType.APPLICATION:
      return [maxPrecedence - 1, maxPrecedence];
    default:
      return [null, null];
  }
};

export const parsePattern = (
  src: Token[],
  i = 0
): [index: number, ast: AbstractSyntaxTree] => {
  return [i, placeholder()];
};

export const parseGroup =
  (precedence = 0, infix = false) =>
  (src: Token[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;

    if (!src[index]) return [index, error(SystemError.endOfSource())];

    if (src[index].src === ':=')
      return [index++, operator(OperatorType.DECLARE)];

    if (src[index].src === '[') {
      index++;

      const [_index, expr] = parseExpr()(src, index);
      index = _index;
      const node = operator(OperatorType.PARENS, expr);

      if (src[index].src !== ']') {
        return [index, error(SystemError.missingToken(']'), node)];
      }

      return [index, node];
    }

    if (src[index].src === '(') {
      index++;

      const [_index, expr] = parseExpr()(src, index);
      index = _index;
      const node = operator(OperatorType.PARENS, expr);

      if (src[index].src !== ')') {
        return [index, error(SystemError.missingToken(')'), node)];
      }

      return [index, node];
    }

    if (infix) return [index, operator(OperatorType.APPLICATION)];

    if (src[index].type === 'newline') return [index, implicitPlaceholder()];
    return [index + 1, token(src[index])];
  };

export const parsePrefix =
  (precedence = 0) =>
  (src: Token[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    //skip possible whitespace prefix
    if (src[index]?.type === 'newline') index++;
    if (!src[index]) return [index, error(SystemError.endOfSource())];

    let [nextIndex, group] = parseGroup(precedence)(src, index);
    index = nextIndex;
    const [, right] = getPrecedence(group.data.operator);

    if (right !== null) {
      let rhs: AbstractSyntaxTree;
      [index, rhs] = parseExpr(right)(src, index);
      return [index, prefix(group, rhs)];
    }

    return [index, group];
  };

export const parseExpr =
  (precedence = 0) =>
  (src: Token[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    let lhs: AbstractSyntaxTree;
    [index, lhs] = parsePrefix(precedence)(src, index);

    while (src[index] && src[index].type !== 'newline') {
      let [nextIndex, group] = parseGroup(precedence, true)(src, index);
      const [left, right] = getPrecedence(group.data.operator);
      if (left === null) break;
      if (left < precedence) break;
      index = nextIndex;

      if (right === null) {
        lhs = postfix(group, lhs);
        continue;
      }

      let rhs: AbstractSyntaxTree;
      [index, rhs] = parseExpr(right)(src, index);

      // if two same operators are next to each other, and their precedence is the same on both sides - it is both left and right associative
      // which means we can put all arguments into one group
      if (left === right && group.data.operator === lhs.data.operator) {
        lhs.children.push(rhs);
      } else {
        lhs = infix(group, lhs, rhs);
      }
    }

    return [index, lhs];
  };

export const parseScript = (src: Token[], i = 0): AbstractSyntaxTree => {
  const children: AbstractSyntaxTree[] = [];
  let index = i;

  while (src[index]) {
    const [_index, astNode] = parseExpr()(src, index);
    index = _index;
    if (src[index] && src[index].type === 'newline') index++;
    children.push(astNode);
  }

  return script(children);
};
