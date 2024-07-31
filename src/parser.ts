import { parseTokens, type Token, type TokenPos } from './tokens.js';
import { SystemError } from './error.js';
import {
  Position,
  mergePositions,
  position,
  tokenPosToSrcPos,
} from './position.js';
import fsp from 'fs/promises';
import { addFile } from './files.js';

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
  data: {
    cause: node ? cause.withNode(node) : cause,
    get position() {
      return node?.data.position ?? cause.data.position;
    },
  },
  children: node ? [node] : [],
});

export const implicitPlaceholder = (
  position: Position
): AbstractSyntaxTree => ({
  name: 'implicit_placeholder',
  data: { position },
  children: [],
});

export const placeholder = (position: Position): AbstractSyntaxTree => ({
  name: 'placeholder',
  data: { position },
  children: [],
});

export const name = (
  value: string | symbol,
  position: Position
): AbstractSyntaxTree => ({
  name: 'name',
  data: { value, position },
  children: [],
});

export const number = (
  value: number,
  position: Position
): AbstractSyntaxTree => ({
  name: 'number',
  data: { value, position },
  children: [],
});

export const string = (
  value: string,
  position: Position
): AbstractSyntaxTree => ({
  name: 'string',
  data: { value, position },
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
    ? error(token.cause)
    : name(token.src, position);

export const operator = (
  operator: string | symbol,
  position: Position,
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
      case OperatorType.IMPORT:
        return [null, 1];

      case OperatorType.DECLARE:
        return [null, 1];
      case OperatorType.ASSIGN:
        return [null, 1];
      case OperatorType.PARENS:
      case OperatorType.SEQUENCE:
        return [null, null];
      case OperatorType.APPLICATION:
        return leftAssociative(maxPrecedence - 2);
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
    data: { operator, precedence: getPrecedence(), position },
    children,
  };
};

export const infix = (
  group: AbstractSyntaxTree,
  lhs: AbstractSyntaxTree,
  rhs: AbstractSyntaxTree
): AbstractSyntaxTree => {
  const {
    data: { operator: _operator, position },
    children,
  } = group;
  const childrenPosition = children.map((child) => child.data.position);
  const merged = mergePositions(
    position,
    lhs.data.position,
    ...childrenPosition,
    rhs.data.position
  );
  return operator(_operator, merged, lhs, ...children, rhs);
};

export const postfix = (
  group: AbstractSyntaxTree,
  lhs: AbstractSyntaxTree
): AbstractSyntaxTree => {
  const {
    data: { operator: _operator, position },
    children,
  } = group;
  const childrenPosition = children.map((child) => child.data.position);
  const merged = mergePositions(
    position,
    lhs.data.position,
    ...childrenPosition
  );
  return operator(_operator, merged, lhs, ...children);
};

export const prefix = (
  group: AbstractSyntaxTree,
  rhs: AbstractSyntaxTree
): AbstractSyntaxTree => {
  const {
    data: { operator: _operator, position },
    children,
  } = group;
  const childrenPosition = children.map((child) => child.data.position);
  const merged = mergePositions(
    position,
    ...childrenPosition,
    rhs.data.position
  );
  return operator(_operator, merged, ...children, rhs);
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
  ATOM = 'atom',
  COLON = ':',
  TUPLE = ',',
  SPREAD = '...',
  NOT = 'not',
  NOT_EQUAL = '!=',
  EQUAL = '==',
  AND = 'and',
  OR = 'or',
  LESS = '<',
  LESS_EQUAL = '<=',
  APPLICATION = 'application',
  PARENS = 'parens',
  OBJECT = 'object',
  INDEX = 'index',
  SEQUENCE = 'sequence',
  BLOCK = 'block',
  FUNCTION = 'func',
  IF = 'if',
  IF_ELSE = 'if_else',
  WHILE = 'while',
  TOKEN = 'token',
  IMPORT = 'import',
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
  (banned: string[] = [], lhs = false) =>
  (src: TokenPos[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    const start = index;
    const nodePosition = () => tokenPosToSrcPos(position(start, index), src);

    if (!src[index]) return [index, error(SystemError.endOfSource())];
    if (banned.includes(src[index].src))
      return [index, implicitPlaceholder(nodePosition())];
    if (banned.includes('\n') && src[index].type === 'newline')
      return [index, implicitPlaceholder(nodePosition())];

    if (src[index].src === ',') {
      index++;
      return [index, operator(OperatorType.TUPLE, nodePosition())];
    }

    if (src[index].src === '...') {
      index++;
      return [index, operator(OperatorType.SPREAD, nodePosition())];
    }

    if (src[index].src === '=') {
      index++;
      return [index, operator(OperatorType.ASSIGN, nodePosition())];
    }

    if (src[index].src === ':') {
      index++;
      return [
        index,
        operator(lhs ? OperatorType.COLON : OperatorType.ATOM, nodePosition()),
      ];
    }

    if (src[index].src === '{') {
      index++;
      if (src[index].type === 'newline') index++;

      const [_index, pattern] = parsePattern(0, ['}'])(src, index);
      index = _index;
      const node = () => operator(OperatorType.OBJECT, nodePosition(), pattern);

      if (src[index].type === 'newline') index++;
      if (src[index]?.src !== '}') {
        return [
          index,
          error(SystemError.missingToken(nodePosition(), '}'), node()),
        ];
      }
      index++;

      return [index, node()];
    }

    if (src[index].src === '(') {
      index++;
      if (src[index].type === 'newline') index++;

      const [_index, pattern] = parsePattern(0, [')'])(src, index);
      index = _index;
      const node = () => operator(OperatorType.PARENS, nodePosition(), pattern);

      if (src[index].type === 'newline') index++;
      if (src[index]?.src !== ')') {
        return [
          index,
          error(SystemError.missingToken(nodePosition(), ')'), node()),
        ];
      }
      index++;

      return [index, node()];
    }

    if (lhs && src[index].src === '[') {
      index++;
      if (src[index].type === 'newline') index++;

      const [_index, pattern] = parseExpr(0, [']'])(src, index);
      index = _index;
      const node = operator(OperatorType.INDEX, nodePosition(), pattern);

      if (src[index].type === 'newline') index++;
      if (src[index].src !== ']') {
        return [
          index,
          error(SystemError.missingToken(nodePosition(), ']'), node),
        ];
      }
      index++;

      return [index, node];
    }

    if (src[index].type === 'newline')
      return [index, implicitPlaceholder(nodePosition())];

    index++;
    return [index, token(src[index - 1], nodePosition())];
  };

export const parsePatternPrefix =
  (banned: string[] = []) =>
  (src: TokenPos[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    //skip possible whitespace prefix
    if (src[index]?.type === 'newline') index++;
    if (!src[index]) return [index, error(SystemError.endOfSource())];

    let [nextIndex, group] = parsePatternGroup(banned)(src, index);
    index = nextIndex;
    const [, right] = group.data.precedence ?? [null, null];

    if (right !== null) {
      let rhs: AbstractSyntaxTree;
      [index, rhs] = parsePattern(right, banned)(src, index);
      return [index, prefix(group, rhs)];
    }

    return [index, group];
  };

export const parsePattern =
  (precedence = 0, banned: string[] = []) =>
  (src: TokenPos[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    let lhs: AbstractSyntaxTree;
    [index, lhs] = parsePatternPrefix(banned)(src, index);

    while (src[index] && src[index].type !== 'newline') {
      let [nextIndex, group] = parsePatternGroup(banned, true)(src, index);
      const [left, right] = group.data.precedence ?? [null, null];
      if (left === null) break;
      if (left <= precedence) break;
      index = nextIndex;

      if (right === null) {
        lhs = postfix(group, lhs);
        continue;
      }

      let rhs: AbstractSyntaxTree;
      [index, rhs] = parsePattern(right, banned)(src, index);

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

export const parseSequence = (
  src: TokenPos[],
  i: number
): [index: number, ast: AbstractSyntaxTree] => {
  let index = i;
  const start = index;
  const nodePosition = () => tokenPosToSrcPos(position(start, index), src);
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

  return [index, operator(OperatorType.SEQUENCE, nodePosition(), ...children)];
};

export const parseGroup =
  (banned: string[] = [], lhs = false) =>
  (src: TokenPos[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    const start = index;
    const nodePosition = () => tokenPosToSrcPos(position(start, index), src);
    // console.log('parseGroup', banned, new Error().stack);

    // console.log('parseGroup', banned, src.slice(index, index + 5));

    if (!src[index]) return [index, error(SystemError.endOfSource())];
    if (banned.includes(src[index].src))
      return [index, implicitPlaceholder(nodePosition())];
    if (banned.includes('\n') && src[index].type === 'newline')
      return [index, implicitPlaceholder(nodePosition())];

    // console.log('parseGroup 2', banned, src.slice(index, index + 5));

    const patternResult = parsePattern(0, banned)(src, index);

    if (src[patternResult[0]] && !lhs && patternResult[1].name !== 'error') {
      let index = patternResult[0];
      const pattern = patternResult[1];
      if (src[index].src === ':=') {
        index++;
        return [index, operator(OperatorType.DECLARE, nodePosition(), pattern)];
      }
      if (src[index].src === '=') {
        index++;
        return [index, operator(OperatorType.ASSIGN, nodePosition(), pattern)];
      }
      if (src[index].src === '->') {
        index++;
        return [
          index,
          operator(OperatorType.FUNCTION, nodePosition(), pattern),
        ];
      }
    }

    if (!lhs && src[index].src === 'import') {
      index++;
      return [index, operator(OperatorType.IMPORT, nodePosition())];
    }

    if (src[index].src === '+') {
      index++;
      return [
        index,
        operator(lhs ? OperatorType.ADD : OperatorType.PLUS, nodePosition()),
      ];
    }

    if (src[index].src === '-') {
      index++;
      return [
        index,
        operator(lhs ? OperatorType.SUB : OperatorType.MINUS, nodePosition()),
      ];
    }

    if (src[index].src === '*') {
      index++;
      return [index, operator(OperatorType.MULT, nodePosition())];
    }

    if (src[index].src === '/') {
      index++;
      return [index, operator(OperatorType.DIV, nodePosition())];
    }

    if (src[index].src === '%') {
      index++;
      return [index, operator(OperatorType.MOD, nodePosition())];
    }

    if (src[index].src === '^') {
      index++;
      return [index, operator(OperatorType.POW, nodePosition())];
    }

    if (!lhs && src[index].src === '|') {
      const children: AbstractSyntaxTree[] = [];
      const node = () => {
        const node = operator(
          OperatorType.PARALLEL,
          nodePosition(),
          ...children
        );
        node.data.precedence = [null, null];
        return node;
      };

      while (src[index] && src[index].src === '|') {
        index++;
        let node: AbstractSyntaxTree;
        [index, node] = parseExpr(0, ['|'])(src, index);
        children.push(node);
        if (src[index].type === 'newline') index++;
      }

      return [index, node()];
    } else if (src[index].src === '|') {
      index++;
      return [index, operator(OperatorType.PARALLEL, nodePosition())];
    }

    if (src[index].src === '<-') {
      index++;
      return [
        index,
        operator(
          lhs ? OperatorType.SEND : OperatorType.RECEIVE,
          nodePosition()
        ),
      ];
    }

    if (src[index].src === '==') {
      index++;
      return [index, operator(OperatorType.EQUAL, nodePosition())];
    }

    if (src[index].src === '!=') {
      index++;
      return [index, operator(OperatorType.NOT_EQUAL, nodePosition())];
    }

    if (!lhs && (src[index].src === 'not' || src[index].src === '!')) {
      index++;
      return [index, operator(OperatorType.NOT, nodePosition())];
    }

    if (src[index].src === '...') {
      index++;
      return [index, operator(OperatorType.SPREAD, nodePosition())];
    }

    if (src[index].src === ',') {
      index++;
      return [index, operator(OperatorType.TUPLE, nodePosition())];
    }

    if (!lhs && src[index].src === '{') {
      index++;
      if (src[index].type === 'newline') index++;
      let sequence: AbstractSyntaxTree;
      [index, sequence] = parseSequence(src, index);
      const node = () => operator(OperatorType.BLOCK, nodePosition(), sequence);

      if (src[index].type === 'newline') index++;
      if (src[index].src !== '}') {
        return [
          index,
          error(SystemError.missingToken(nodePosition(), '}'), node()),
        ];
      }
      index++;
      return [index, node()];
    }

    if (!lhs && src[index].src === 'fn') {
      index++;
      let pattern: AbstractSyntaxTree;
      [index, pattern] = parsePattern(0, ['{', '->'])(src, index);
      const token = src[index].src;

      if (token === '{') {
        index++;
        if (src[index].type === 'newline') index++;
        let sequence: AbstractSyntaxTree;
        [index, sequence] = parseSequence(src, index);

        const node = () => {
          const node = operator(
            OperatorType.FUNCTION,
            nodePosition(),
            pattern,
            sequence
          );
          node.data.precedence = [null, null];
          return node;
        };

        if (src[index].type === 'newline') index++;
        if (src[index].src !== '}') {
          return [
            index,
            error(SystemError.missingToken(nodePosition(), '}'), node()),
          ];
        }

        index++;
        return [index, node()];
      }

      if (token === '->') {
        index++;
        return [
          index,
          operator(OperatorType.FUNCTION, nodePosition(), pattern),
        ];
      }

      return [
        index,
        error(
          SystemError.missingToken(nodePosition(), '->', '{'),
          operator(OperatorType.FUNCTION, nodePosition(), pattern)
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
        if (src[index].type === 'newline') index++;
        let sequence: AbstractSyntaxTree;
        [index, sequence] = parseSequence(src, index);

        const node = () => {
          const node = operator(
            OperatorType.IF,
            nodePosition(),
            condition,
            sequence
          );
          node.data.precedence = [null, null];
          return node;
        };
        if (src[index].type === 'newline') index++;
        if (src[index].src !== '}') {
          return [
            index,
            error(SystemError.missingToken(nodePosition(), '}'), node()),
          ];
        }
        index++;

        if (src[index].src === 'else') {
          index++;
          return [
            index,
            operator(OperatorType.IF_ELSE, nodePosition(), condition, sequence),
          ];
        }

        return [index, node()];
      }

      if (token === ':' || token.includes('\n')) {
        index++;
        const [_index, body] = parseExpr(0, ['else'])(src, index);

        if (src[_index].src !== 'else') {
          return [index, operator(OperatorType.IF, nodePosition(), condition)];
        }

        index = _index + 1;
        return [
          index,
          operator(OperatorType.IF_ELSE, nodePosition(), condition, body),
        ];
      }

      return [
        index,
        error(
          SystemError.missingToken(nodePosition(), ':', '\\n', '{'),
          operator(OperatorType.IF, nodePosition(), condition)
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
        if (src[index].type === 'newline') index++;
        let sequence: AbstractSyntaxTree;
        [index, sequence] = parseSequence(src, index);
        const node = () => {
          const node = operator(
            OperatorType.WHILE,
            nodePosition(),
            condition,
            sequence
          );
          node.data.precedence = [null, null];
          return node;
        };
        if (src[index].type === 'newline') index++;
        if (src[index].src !== '}') {
          return [
            index,
            error(SystemError.missingToken(nodePosition(), '}'), node()),
          ];
        }
        index++;

        return [index, node()];
      }

      if (token === ':' || token.includes('\n')) {
        index++;
        return [index, operator(OperatorType.WHILE, nodePosition(), condition)];
      }

      return [
        index,
        error(
          SystemError.missingToken(nodePosition(), ':', '\\n', '{'),
          operator(OperatorType.WHILE, nodePosition(), condition)
        ),
      ];
    }

    if (src[index].src === '[') {
      index++;
      if (src[index].type === 'newline') index++;

      const [_index, expr] = parseExpr(0, [']'])(src, index);
      index = _index;
      const node = operator(OperatorType.INDEX, nodePosition(), expr);

      if (src[index].type === 'newline') index++;
      if (src[index].src !== ']') {
        return [
          index,
          error(SystemError.missingToken(nodePosition(), ']'), node),
        ];
      }
      index++;

      return [index, node];
    }

    if (!lhs && src[index].src === '(') {
      index++;
      if (src[index].type === 'newline') index++;

      const [_index, expr] = parseExpr(0, [')'])(src, index);
      index = _index;
      const node = () => operator(OperatorType.PARENS, nodePosition(), expr);

      if (src[index].type === 'newline') index++;
      if (src[index].src !== ')') {
        return [
          index,
          error(SystemError.missingToken(nodePosition(), ')'), node()),
        ];
      }
      index++;

      return [index, node()];
    }

    if (lhs) return [index, operator(OperatorType.APPLICATION, nodePosition())];

    if (src[index].type === 'newline')
      return [index, implicitPlaceholder(nodePosition())];

    index++;
    return [index, token(src[index - 1], nodePosition())];
  };

export const parsePrefix =
  (banned: string[] = []) =>
  (src: TokenPos[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    //skip possible whitespace prefix
    if (src[index]?.type === 'newline') index++;
    if (!src[index]) return [index, error(SystemError.endOfSource())];

    let [nextIndex, group] = parseGroup(banned)(src, index);
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
  (src: TokenPos[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    let lhs: AbstractSyntaxTree;
    [index, lhs] = parsePrefix(banned)(src, index);

    while (src[index] && src[index].type !== 'newline') {
      let [nextIndex, group] = parseGroup(banned, true)(src, index);
      const [left, right] = group.data.precedence ?? [null, null];
      if (left === null) break;
      if (left <= precedence) break;
      index = nextIndex;

      if (right === null) {
        lhs = postfix(group, lhs);
        continue;
      }

      let rhs: AbstractSyntaxTree;
      [index, rhs] = parseExpr(right, banned)(src, index);

      // if two same operators are next to each other, and their precedence is the same on both sides - it is both left and right associative
      // which means we can put all arguments into one group
      if (
        left === right &&
        group.data.operator === lhs.data.operator &&
        rhs.name !== 'implicit_placeholder'
      ) {
        lhs.children.push(rhs);
      } else {
        lhs = infix(group, lhs, rhs);
      }
    }

    return [index, lhs];
  };

export const parseScript = (src: TokenPos[], i = 0): AbstractSyntaxTree => {
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

export const parseFile = async (path: string) => {
  const code = await fsp.readFile(path, 'utf-8');
  const fileId = addFile(path, code);
  const tokens = parseTokens(code);
  const script = parseScript(tokens);
  script.data.fileId = fileId;
  return script;
};
