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
): AbstractSyntaxTree => {
  const getPrecedence = (): Precedence => {
    const semicolonPrecedence = 1;
    const assignmentPrecedence = semicolonPrecedence + 1;
    const booleanPrecedence = assignmentPrecedence + 2;
    const tuplePrecedence = booleanPrecedence + 4;
    const arithmeticPrecedence = tuplePrecedence + 3;
    const maxPrecedence = Number.MAX_SAFE_INTEGER;
    switch (operator) {
      case OperatorType.DECLARE:
        return [null, 1];
      case OperatorType.ASSIGN:
        return [null, 1];
      case OperatorType.PRINT:
        return [null, 1];
      case OperatorType.PARENS:
      case OperatorType.BLOCK:
        return [null, null];
      case OperatorType.APPLICATION:
        return leftAssociative(maxPrecedence);
      case OperatorType.INDEX:
        return [maxPrecedence, null];

      case OperatorType.TUPLE:
        return associative(tuplePrecedence);
      case OperatorType.SPREAD:
        return [null, tuplePrecedence + 1];
      case OperatorType.FUNCTION:
        return [null, 2];
      case OperatorType.IF:
        return [null, 2];
      case OperatorType.IF_ELSE:
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
      case OperatorType.NOT:
        return [null, booleanPrecedence + 5];

      case OperatorType.PARALLEL:
        return associative(assignmentPrecedence + 1);
      case OperatorType.SEND:
        return rightAssociative(assignmentPrecedence + 2);
      case OperatorType.RECEIVE:
        return [null, assignmentPrecedence + 2];

      case OperatorType.ADD:
        return associative(arithmeticPrecedence);
      case OperatorType.SUB:
        return leftAssociative(arithmeticPrecedence + 1);
      case OperatorType.MULT:
        return associative(arithmeticPrecedence + 3);
      case OperatorType.DIV:
        return leftAssociative(arithmeticPrecedence + 4);
      case OperatorType.MOD:
        return leftAssociative(arithmeticPrecedence + 4);
      case OperatorType.POW:
        return rightAssociative(arithmeticPrecedence + 6);
      default:
        return [null, null];
    }
  };
  return {
    name: 'operator',
    data: { operator, precedence: getPrecedence() },
    children,
  };
};

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
  TUPLE = ',',
  SPREAD = '...',
  NOT = 'not',
  NOT_EQUAL = '!=',
  EQUAL = '==',
  AND = 'and',
  OR = 'or',
  LESS = '<',
  LESS_EQUAL = '<=',
  PRINT = 'print',
  APPLICATION = 'application',
  PARENS = 'parens',
  INDEX = 'index',
  BLOCK = 'block',
  FUNCTION = 'func',
  IF = 'if',
  IF_ELSE = 'if_else',
  WHILE = 'while',
  TOKEN = 'token',
}

// if two same operators are next to each other, which one will take precedence
// left associative - left one will take precedence
// right associative - right one will take precedence
// associative - does not matter, can be grouped in any order
export const leftAssociative = (precedence: number): Precedence => [
  precedence,
  precedence + 1,
];
export const rightAssociative = (precedence: number): Precedence => [
  precedence + 1,
  precedence,
];
export const associative = (precedence: number): Precedence => [
  precedence,
  precedence,
];

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
      index++;

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
    const [, right] = group.data.precedence ?? [null, null];

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
      const [left, right] = group.data.precedence ?? [null, null];
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

    return [index, lhs];
  };

export const parseBlockSequence = (
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
    [index, node] = parseExpr(0, ['}'])(src, index);
    children.push(node);
  }

  return [index, operator(OperatorType.BLOCK, ...children)];
};

export const parseGroup =
  (precedence = 0, banned: string[] = [], lhs = false) =>
  (src: Token[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    // console.log('parseGroup', banned, new Error().stack);

    if (!src[index]) return [index, error(SystemError.endOfSource())];
    if (banned.includes(src[index].src)) return [index, implicitPlaceholder()];
    if (banned.includes('\n') && src[index].type === 'newline')
      return [index, implicitPlaceholder()];

    const patternResult = parsePattern()(src, index);

    if (!lhs && patternResult[1].name !== 'error') {
      let index = patternResult[0];
      const pattern = patternResult[1];
      if (src[index].src === ':=') {
        return [index + 1, operator(OperatorType.DECLARE, pattern)];
      }
      if (src[index].src === '=') {
        return [index + 1, operator(OperatorType.ASSIGN, pattern)];
      }
      if (src[index].src === '->') {
        return [index + 1, operator(OperatorType.FUNCTION, pattern)];
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

    if (src[index].src === '^') {
      return [index + 1, operator(OperatorType.POW)];
    }

    if (src[index].src === '|') {
      const node = operator(OperatorType.PARALLEL);
      if (!lhs) node.data.precedence = [null, 1];
      return [index + 1, node];
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

    if (!lhs && (src[index].src === 'not' || src[index].src === '!')) {
      return [index + 1, operator(OperatorType.NOT)];
    }

    if (src[index].src === '...') {
      return [index + 1, operator(OperatorType.SPREAD)];
    }

    if (src[index].src === ',') {
      return [index + 1, operator(OperatorType.TUPLE)];
    }

    if (!lhs && src[index].src === 'print') {
      return [index + 1, operator(OperatorType.PRINT)];
    }

    if (!lhs && src[index].src === '{') {
      index++;
      let block: AbstractSyntaxTree;
      [index, block] = parseBlockSequence(src, index);
      if (src[index].src !== '}') {
        return [index, error(SystemError.missingToken('}'), block)];
      }
      return [index + 1, block];
    }

    if (!lhs && src[index].src === 'fn') {
      index++;
      let pattern: AbstractSyntaxTree;
      [index, pattern] = parsePattern()(src, index);
      const token = src[index].src;

      if (token === '{') {
        index++;
        let body: AbstractSyntaxTree;
        [index, body] = parseBlockSequence(src, index);

        const node = operator(OperatorType.FUNCTION, pattern, body);
        node.data.precedence = [null, null];
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

    if (!lhs && src[index].src === 'if') {
      index++;
      let condition: AbstractSyntaxTree;
      [index, condition] = parseExpr(0, [':', '\n', '{'])(src, index);
      const token = src[index].src;

      if (token === '{') {
        index++;
        let body: AbstractSyntaxTree;
        [index, body] = parseBlockSequence(src, index);
        const node = operator(OperatorType.IF, condition, body);
        node.data.precedence = [null, null];
        if (src[index].src !== '}') {
          return [index, error(SystemError.missingToken('}'), node)];
        }
        index++;

        if (src[index].src === 'else') {
          return [index + 1, operator(OperatorType.IF_ELSE, condition, body)];
        }

        return [index, node];
      }

      if (token === ':' || token.includes('\n')) {
        index++;
        const [_index, body] = parseExpr(precedence, ['else'])(src, index);

        if (src[_index].src !== 'else') {
          return [index, operator(OperatorType.IF, condition)];
        }

        return [_index + 1, operator(OperatorType.IF_ELSE, condition, body)];
      }

      return [
        index,
        error(
          SystemError.missingToken(':', '\\n', '{'),
          operator(OperatorType.IF, condition)
        ),
      ];
    }

    if (!lhs && src[index].src === 'while') {
      index++;
      let condition: AbstractSyntaxTree;
      [index, condition] = parseExpr(0, [':', '\n', '{'])(src, index);
      const token = src[index].src;

      if (token === '{') {
        index++;
        let body: AbstractSyntaxTree;
        [index, body] = parseBlockSequence(src, index);
        const node = operator(OperatorType.WHILE, condition, body);
        node.data.precedence = [null, null];
        if (src[index].src !== '}') {
          return [index, error(SystemError.missingToken('}'), node)];
        }
        index++;

        return [index, node];
      }

      if (token === ':' || token.includes('\n')) {
        index++;
        return [index, operator(OperatorType.WHILE, condition)];
      }

      return [
        index,
        error(
          SystemError.missingToken(':', '\\n', '{'),
          operator(OperatorType.WHILE, condition)
        ),
      ];
    }

    if (src[index].src === '[') {
      index++;

      const [_index, expr] = parseExpr(0, [']'])(src, index);
      index = _index;
      const node = operator(OperatorType.INDEX, expr);

      if (src[index].src !== ']') {
        return [index, error(SystemError.missingToken(']'), node)];
      }
      index++;

      return [index, node];
    }

    if (!lhs && src[index].src === '(') {
      index++;

      const [_index, expr] = parseExpr(0, [')'])(src, index);
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
  (precedence = 0, banned: string[] = []) =>
  (src: Token[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    //skip possible whitespace prefix
    if (src[index]?.type === 'newline') index++;
    if (!src[index]) return [index, error(SystemError.endOfSource())];

    let [nextIndex, group] = parseGroup(precedence, banned)(src, index);
    index = nextIndex;
    const [, right] = group.data.precedence ?? [null, null];

    if (right !== null) {
      let rhs: AbstractSyntaxTree;
      [index, rhs] = parseExpr(right, banned)(src, index);
      return [index, prefix(group, rhs)];
    }

    return [index, group];
  };

export const parseExpr =
  (precedence = 0, banned: string[] = []) =>
  (src: Token[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    let lhs: AbstractSyntaxTree;
    [index, lhs] = parsePrefix(precedence, banned)(src, index);

    while (src[index] && src[index].type !== 'newline') {
      if (index > 6 && index < 12) {
        console.log(
          'parseExpr 2',
          lhs,
          index,
          precedence,
          src[index],
          banned,
          new Error().stack
        );
      }
      let [nextIndex, group] = parseGroup(precedence, banned, true)(src, index);
      if (index > 6 && index < 12) {
        console.log(
          'parseExpr 3',
          nextIndex,
          group,
          lhs,
          index,
          precedence,
          src[index],
          banned,
          new Error().stack
        );
      }
      const [left, right] = group.data.precedence ?? [null, null];
      if (left === null) break;
      if (left < precedence) break;
      index = nextIndex;

      if (right === null) {
        lhs = postfix(group, lhs);
        continue;
      }

      let rhs: AbstractSyntaxTree;
      [index, rhs] = parseExpr(right, banned)(src, index);

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
