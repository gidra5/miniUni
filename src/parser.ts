import type { Token } from './tokens';
import { SystemError } from './error';

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
    data: { operator: _operator },
    children,
  } = group;
  return operator(_operator, lhs, ...children, rhs);
};

export const postfix = (
  group: AbstractSyntaxTree,
  lhs: AbstractSyntaxTree
): AbstractSyntaxTree => {
  const {
    data: { operator: _operator },
    children,
  } = group;
  return operator(_operator, lhs, ...children);
};

export const prefix = (
  group: AbstractSyntaxTree,
  rhs: AbstractSyntaxTree
): AbstractSyntaxTree => {
  const {
    data: { operator: _operator },
    children,
  } = group;
  return operator(_operator, ...children, rhs);
};

const script = (children: AbstractSyntaxTree[]): AbstractSyntaxTree => ({
  name: 'script',
  data: {},
  children,
});

enum OperatorType {
  ADD = 'add',
  PLUS = 'plus',
  SUB = 'subtract',
  MINUS = 'minus',
  DIV = '/',
  MULT = '*',
  MOD = '%',
  PARALLEL = 'parallel',
  PARALLEL_PREFIX = 'parallel_prefix',
  RECEIVE = 'receive',
  SEND = 'send',
  DECLARE = ':=',
  ASSIGN = '=',
  TUPLE = ',',
  SPREAD = '...',
  NOT = 'not',
  NOT_EQUAL = '!=',
  EQUAL = '==',
  PRINT = 'print',
  APPLICATION = 'application',
  PARENS = 'parens',
  INDEX = 'index',
  BLOCK = 'block',
  FUNCTION = 'func',
  FUNCTION_BLOCK = 'func_block',
  IF = 'if',
  IF_BLOCK = 'if_block',
  IF_ELSE = 'if_else',
  PATTERN = 'pattern',
  TOKEN = 'token',
}

const getPrecedence = (operator = OperatorType.TOKEN): Precedence => {
  const maxPrecedence = Number.MAX_SAFE_INTEGER;
  switch (operator) {
    case OperatorType.PARENS:
      return [maxPrecedence, 0];
    case OperatorType.APPLICATION:
      return [maxPrecedence - 1, maxPrecedence];
    case OperatorType.INDEX:
      return [maxPrecedence, null];
    case OperatorType.ADD:

    default:
      return [null, null];
  }
};

export const parsePatternGroup =
  (precedence = 0, infix = false) =>
  (src: Token[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;

    if (!src[index]) return [index, error(SystemError.endOfSource())];

    if (src[index].src === ',') {
      return [index + 1, operator(OperatorType.TUPLE)];
    }

    if (src[index].src === '...') {
      return [index + 1, operator(OperatorType.SPREAD)];
    }

    if (src[index].src === '=') {
      return [index + 1, operator(OperatorType.ASSIGN)];
    }

    if (src[index].src === '(') {
      index++;

      const [_index, expr] = parsePattern()(src, index);
      index = _index;
      const node = operator(OperatorType.PARENS, expr);

      if (src[index].src !== ')') {
        return [index, error(SystemError.missingToken(')'), node)];
      }

      return [index, node];
    }

    if (src[index].type === 'newline') return [index, implicitPlaceholder()];
    return [index + 1, token(src[index])];
  };

export const parsePatternPrefix =
  (precedence = 0) =>
  (src: Token[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    //skip possible whitespace prefix
    if (src[index]?.type === 'newline') index++;
    if (!src[index]) return [index, error(SystemError.endOfSource())];

    let [nextIndex, group] = parsePatternGroup(precedence)(src, index);
    index = nextIndex;
    const [, right] = getPrecedence(group.data.operator);

    if (right !== null) {
      let rhs: AbstractSyntaxTree;
      [index, rhs] = parsePattern(right)(src, index);
      return [index, prefix(group, rhs)];
    }

    return [index, group];
  };

export const parsePattern =
  (precedence = 0) =>
  (src: Token[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    let lhs: AbstractSyntaxTree;
    [index, lhs] = parsePatternPrefix(precedence)(src, index);

    while (src[index] && src[index].type !== 'newline') {
      let [nextIndex, group] = parsePatternGroup(precedence, true)(src, index);
      const [left, right] = getPrecedence(group.data.operator);
      if (left === null) break;
      if (left < precedence) break;
      index = nextIndex;

      if (right === null) {
        lhs = postfix(group, lhs);
        continue;
      }

      let rhs: AbstractSyntaxTree;
      [index, rhs] = parsePattern(right)(src, index);

      // if two same operators are next to each other, and their precedence is the same on both sides - it is both left and right associative
      // which means we can put all arguments into one group
      if (left === right && group.data.operator === lhs.data.operator) {
        lhs.children.push(rhs);
      } else {
        lhs = infix(group, lhs, rhs);
      }
    }

    return [index, operator(OperatorType.PATTERN)];
  };

export const parseSequence = (
  src: Token[],
  i: number
): [index: number, ast: AbstractSyntaxTree] => {
  let index = i;
  const children: AbstractSyntaxTree[] = [];

  while (src[index] && src[index].src !== '}') {
    if (src[index].type === 'newline') {
      index++;
      continue;
    }
    if (src[index].src === ';') {
      index++;
      continue;
    }
    let node: AbstractSyntaxTree;
    [index, node] = parseExpr()(src, index);
    children.push(node);
  }

  return [index, operator(OperatorType.BLOCK, ...children)];
};

export const parseGroup =
  (precedence = 0, lhs = false) =>
  (src: Token[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;

    if (!src[index]) return [index, error(SystemError.endOfSource())];

    const patternResult = parsePattern()(src, index);

    if (patternResult[1].name !== 'error') {
      let index = patternResult[0];
      const pattern = patternResult[1];
      if (src[index].src === ':=') {
        return [index + 1, operator(OperatorType.DECLARE, pattern)];
      }
      if (src[index].src === '=') {
        return [index + 1, operator(OperatorType.ASSIGN, pattern)];
      }
    }

    if (src[index].src === '+') {
      return [index + 1, operator(lhs ? OperatorType.ADD : OperatorType.PLUS)];
    }

    if (src[index].src === '-') {
      return [index + 1, operator(lhs ? OperatorType.SUB : OperatorType.MINUS)];
    }

    if (src[index].src === '*') {
      return [index + 1, operator(OperatorType.MULT)];
    }

    if (src[index].src === '/') {
      return [index + 1, operator(OperatorType.DIV)];
    }

    if (src[index].src === '%') {
      return [index + 1, operator(OperatorType.MOD)];
    }

    if (src[index].src === '|') {
      return [
        index + 1,
        operator(lhs ? OperatorType.PARALLEL : OperatorType.PARALLEL_PREFIX),
      ];
    }

    if (src[index].src === '<-') {
      return [
        index + 1,
        operator(lhs ? OperatorType.SEND : OperatorType.RECEIVE),
      ];
    }

    if (src[index].src === '==') {
      return [index + 1, operator(OperatorType.EQUAL)];
    }

    if (src[index].src === '!=') {
      return [index + 1, operator(OperatorType.NOT_EQUAL)];
    }

    if (src[index].src === 'not' || src[index].src === '!') {
      return [index + 1, operator(OperatorType.NOT)];
    }

    if (src[index].src === '...') {
      return [index + 1, operator(OperatorType.SPREAD)];
    }

    if (src[index].src === ',') {
      return [index + 1, operator(OperatorType.TUPLE)];
    }

    if (src[index].src === 'print') {
      return [index + 1, operator(OperatorType.PRINT)];
    }

    if (src[index].src === '{') {
      index++;
      let block: AbstractSyntaxTree;
      [index, block] = parseSequence(src, index);
      if (src[index].src !== '}') {
        return [index, error(SystemError.missingToken('}'), block)];
      }
      return [index + 1, block];
    }

    if (src[index].src === 'fn') {
      index++;
      let pattern: AbstractSyntaxTree;
      [index, pattern] = parsePattern()(src, index);
      const token = src[index].src;

      if (token === '{') {
        index++;
        let body: AbstractSyntaxTree;
        [index, body] = parseSequence(src, index);

        const node = operator(OperatorType.FUNCTION_BLOCK, pattern, body);
        if (src[index].src !== '}') {
          return [index, error(SystemError.missingToken('}'), node)];
        }

        return [index + 1, node];
      }

      if (token === '->') {
        index++;

        return [index, operator(OperatorType.FUNCTION, pattern)];
      }

      return [
        index,
        error(
          SystemError.missingToken('->', '{'),
          operator(OperatorType.FUNCTION, pattern)
        ),
      ];
    }

    if (src[index].src === 'if') {
      index++;
      let condition: AbstractSyntaxTree;
      [index, condition] = parseExpr()(src, index);
      const token = src[index].src;

      if (token === '{') {
        index++;
        let body: AbstractSyntaxTree;
        [index, body] = parseSequence(src, index);
        const node = operator(OperatorType.IF_BLOCK, condition, body);
        if (src[index].src !== '}') {
          return [index, error(SystemError.missingToken('}'), node)];
        }
        index++;

        if (src[index].src === 'else') {
          return [index + 1, operator(OperatorType.IF_ELSE, condition, body)];
        }

        return [index, node];
      }

      if (token === ':') {
        index++;
        let body: AbstractSyntaxTree;
        [index, body] = parseExpr(precedence)(src, index);

        if (src[index].src === 'else') {
          index++;
          return [index, operator(OperatorType.IF_ELSE, condition, body)];
        }

        return [index, operator(OperatorType.IF, condition)];
      }

      return [
        index,
        error(
          SystemError.missingToken(':', '{'),
          operator(OperatorType.IF, condition)
        ),
      ];
    }

    if (src[index].src === '[') {
      index++;

      const [_index, expr] = parseExpr()(src, index);
      index = _index;
      const node = operator(OperatorType.PARENS, expr);

      if (src[index].src !== ']') {
        return [index, error(SystemError.missingToken(']'), node)];
      }
      index++;

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
      index++;

      return [index, node];
    }

    if (lhs) return [index, operator(OperatorType.APPLICATION)];

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
    if (src[index].type === 'newline') {
      index++;
      continue;
    }
    if (src[index].src === ';') {
      index++;
      continue;
    }
    const [_index, astNode] = parseExpr()(src, index);
    index = _index;
    children.push(astNode);
  }

  return script(children);
};
