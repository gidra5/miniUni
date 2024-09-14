import { type Token, type TokenPos } from './tokens.js';
import { SystemError } from './error.js';
import {
  Position,
  indexPosition,
  mergePositions,
  position,
  mapListPosToPos,
} from './position.js';

export type AbstractSyntaxTree<T = any> = {
  type: string;
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

export const error = (
  cause: SystemError,
  node: AbstractSyntaxTree | Position
): AbstractSyntaxTree => ({
  type: NodeType.ERROR,
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
  data: { position },
  children: [],
});

export const placeholder = (position: Position): AbstractSyntaxTree => ({
  type: NodeType.PLACEHOLDER,
  data: { position },
  children: [],
});

export const name = (
  value: string | symbol,
  position: Position
): AbstractSyntaxTree => ({
  type: NodeType.NAME,
  data: { value, position },
  children: [],
});

export const number = (
  value: number,
  position: Position
): AbstractSyntaxTree => ({
  type: NodeType.NUMBER,
  data: { value, position },
  children: [],
});

export const string = (
  value: string,
  position: Position
): AbstractSyntaxTree => ({
  type: NodeType.STRING,
  data: { value, position },
  children: [],
});

export const tokenError = (
  token: Extract<Token, { type: 'error' }>,
  position: Position
): AbstractSyntaxTree => ({
  type: NodeType.ERROR,
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

export const operator = (
  operator: string | symbol,
  position: Position,
  ...children: AbstractSyntaxTree[]
): AbstractSyntaxTree => {
  const getPrecedence = (): Precedence => {
    const semicolonPrecedence = 1;
    const assignmentPrecedence = semicolonPrecedence + 1;
    const tuplePrecedence = assignmentPrecedence + 4;
    const booleanPrecedence = tuplePrecedence + 2;
    const arithmeticPrecedence = booleanPrecedence + 3;
    const maxPrecedence = Number.MAX_SAFE_INTEGER;
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
      case OperatorType.SEQUENCE:
        return [null, null];
      case OperatorType.APPLICATION:
        return leftAssociative(maxPrecedence - 2);
      case OperatorType.INDEX:
        return [maxPrecedence - 3, null];

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
      case OperatorType.MINUS:
        return [null, arithmeticPrecedence + 7];
      case OperatorType.PLUS:
        return [null, arithmeticPrecedence + 7];
      case OperatorType.ATOM:
        return [null, maxPrecedence - 3];
      default:
        return [null, null];
    }
  };
  return {
    type: NodeType.OPERATOR,
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

const module = (children: AbstractSyntaxTree[]): AbstractSyntaxTree => ({
  type: NodeType.MODULE,
  data: {},
  children,
});

const script = (children: AbstractSyntaxTree[]): AbstractSyntaxTree => ({
  type: NodeType.SCRIPT,
  data: {},
  children,
});

const block = (
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

const idToExprOp = {
  '+': OperatorType.ADD,
  '-': OperatorType.SUB,
  '*': OperatorType.MULT,
  '/': OperatorType.DIV,
  '%': OperatorType.MOD,
  '^': OperatorType.POW,
  '==': OperatorType.EQUAL,
  '!=': OperatorType.NOT_EQUAL,
  '<': OperatorType.LESS,
  '<=': OperatorType.LESS_EQUAL,
  '>': OperatorType.GREATER,
  '>=': OperatorType.GREATER_EQUAL,
  '++': OperatorType.POST_INCREMENT,
  '--': OperatorType.POST_DECREMENT,
  '->': OperatorType.FUNCTION,
  ',': OperatorType.TUPLE,
  ':': OperatorType.COLON,
  '<-': OperatorType.SEND,
  '?<-': OperatorType.SEND_STATUS,
  '|': OperatorType.PARALLEL,
  and: OperatorType.AND,
  or: OperatorType.OR,
};

const idToPrefixExprOp = {
  '!': OperatorType.NOT,
  '-': OperatorType.MINUS,
  '+': OperatorType.PLUS,
  '++': OperatorType.INCREMENT,
  '--': OperatorType.DECREMENT,
  '...': OperatorType.SPREAD,
  ':': OperatorType.ATOM,
  '<-': OperatorType.RECEIVE,
  '<-?': OperatorType.RECEIVE_STATUS,
  not: OperatorType.NOT,
  async: OperatorType.ASYNC,
  loop: OperatorType.LOOP,
  export: OperatorType.EXPORT,
};

const idToLhsPatternExprOp = {
  '->': OperatorType.FUNCTION,
  ':=': OperatorType.DECLARE,
  '=': OperatorType.ASSIGN,
  '+=': OperatorType.INC_ASSIGN,
};

const idToPatternOp = {
  ',': OperatorType.TUPLE,
  '=': OperatorType.ASSIGN,
  ':': OperatorType.COLON,
};

const idToPrefixPatternOp = {
  '...': OperatorType.SPREAD,
  ':': OperatorType.ATOM,
  export: OperatorType.EXPORT,
  mut: OperatorType.MUTABLE,
};

const tokenIncludes = (token: Token | undefined, tokens: string[]): boolean =>
  !!token &&
  (tokens.includes(token.src) ||
    (tokens.includes('\n') && token.type === 'newline'));

let parens = 0;
let squareBrackets = 0;
let brackets = 0;
const followSet: string[] = [];

const parsePatternGroup =
  (banned: string[] = [], skip: string[] = [], lhs = false) =>
  (src: TokenPos[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    const start = index;
    const nodePosition = () => mapListPosToPos(position(start, index), src);

    if (!src[index])
      return [
        index,
        error(SystemError.endOfSource(nodePosition()), nodePosition()),
      ];

    if (tokenIncludes(src[index], skip))
      return parsePatternGroup(banned, skip, lhs)(src, index + 1);
    if (tokenIncludes(src[index], banned))
      return [index, implicitPlaceholder(nodePosition())];
    if (tokenIncludes(src[index], followSet))
      return [index, implicitPlaceholder(nodePosition())];

    if (!lhs && src[index].src in idToPrefixPatternOp) {
      const op = idToPrefixPatternOp[src[index].src];
      index++;
      return [index, operator(op, nodePosition())];
    }

    if (lhs && src[index].src in idToPatternOp) {
      const op = idToPatternOp[src[index].src];
      index++;
      return [index, operator(op, nodePosition())];
    }

    if (src[index].src === '{') {
      index++;
      brackets++;
      if (src[index]?.type === 'newline') index++;

      followSet.push('}');
      const [_index, pattern] = parsePattern(0, ['}'])(src, index);
      followSet.pop();
      index = _index;
      const node = () => {
        const node = operator(OperatorType.OBJECT, nodePosition());
        if (pattern.data.operator === OperatorType.TUPLE) {
          node.children = pattern.children;
        } else {
          node.children.push(pattern);
        }
        return node;
      };

      if (src[index]?.type === 'newline') index++;
      if (src[index]?.src !== '}') {
        return [
          index,
          error(SystemError.missingToken(nodePosition(), '}'), node()),
        ];
      }
      index++;
      brackets--;

      return [index, node()];
    }

    if (src[index].src === '(') {
      index++;
      parens++;
      if (src[index]?.type === 'newline') index++;

      followSet.push(')');
      const [_index, pattern] = parsePattern(0, [')'], ['\n'])(src, index);
      followSet.pop();
      index = _index;
      const node = () => operator(OperatorType.PARENS, nodePosition(), pattern);

      if (src[index]?.type === 'newline') index++;
      if (src[index]?.src !== ')') {
        return [
          index,
          error(SystemError.missingToken(nodePosition(), ')'), node()),
        ];
      }
      parens--;
      index++;

      return [index, node()];
    }

    if (lhs && src[index].src === '[') {
      index++;
      squareBrackets++;
      if (src[index]?.type === 'newline') index++;

      followSet.push(']');
      const [_index, pattern] = parseExpr(0, [']'], ['\n'])(src, index);
      followSet.pop();
      index = _index;
      const node = () => operator(OperatorType.INDEX, nodePosition(), pattern);

      if (src[index]?.type === 'newline') index++;
      if (src[index]?.src !== ']') {
        return [
          index,
          error(SystemError.missingToken(nodePosition(), ']'), node()),
        ];
      }
      squareBrackets--;
      index++;

      return [index, node()];
    }

    index++;
    return [index, token(src[index - 1], nodePosition())];
  };

const parsePatternPrefix =
  (banned: string[] = [], skip: string[] = []) =>
  (src: TokenPos[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    let group: AbstractSyntaxTree;
    [index, group] = parsePatternGroup(banned, skip)(src, index);
    const [, right] = group.data.precedence ?? [null, null];

    if (right !== null) {
      let rhs: AbstractSyntaxTree;
      [index, rhs] = parsePattern(right, banned, skip)(src, index);
      return [index, prefix(group, rhs)];
    }

    return [index, group];
  };

const parsePattern =
  (precedence = 0, banned: string[] = [], skip: string[] = []) =>
  (src: TokenPos[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    let lhs: AbstractSyntaxTree;
    [index, lhs] = parsePatternPrefix(banned, skip)(src, index);

    while (src[index] && !tokenIncludes(src[index], ['\n'])) {
      let [nextIndex, group] = parsePatternGroup(
        banned,
        skip,
        true
      )(src, index);
      const [left, right] = group.data.precedence ?? [null, null];
      if (left === null) break;
      if (left <= precedence) break;
      index = nextIndex;

      if (right === null) {
        lhs = postfix(group, lhs);
        continue;
      }

      let rhs: AbstractSyntaxTree;
      [index, rhs] = parsePattern(right, banned, skip)(src, index);

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

const parseGroup =
  (banned: string[] = [], skip: string[] = [], lhs = false) =>
  (src: TokenPos[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    const start = index;
    const nodePosition = () => mapListPosToPos(position(start, index), src);

    if (!src[index]) {
      return [
        index,
        error(SystemError.endOfSource(nodePosition()), nodePosition()),
      ];
    }

    if (parens === 0 && src[index].src === ')') {
      while (src[index] && src[index].src === ')') index++;
      return [
        index,
        error(
          SystemError.unbalancedCloseToken(['(', ')'], nodePosition()),
          nodePosition()
        ),
      ];
    }
    if (brackets === 0 && src[index].src === '}') {
      while (src[index] && src[index].src === '}') index++;
      return [
        index,
        error(
          SystemError.unbalancedCloseToken(['{', '}'], nodePosition()),
          nodePosition()
        ),
      ];
    }
    if (squareBrackets === 0 && src[index].src === ']') {
      while (src[index] && src[index].src === ']') index++;
      return [
        index,
        error(
          SystemError.unbalancedCloseToken(['[', ']'], nodePosition()),
          nodePosition()
        ),
      ];
    }

    if (tokenIncludes(src[index], skip))
      return parseGroup(banned, skip, lhs)(src, index + 1);
    if (tokenIncludes(src[index], banned))
      return [index, implicitPlaceholder(nodePosition())];
    if (tokenIncludes(src[index], followSet))
      return [index, implicitPlaceholder(nodePosition())];

    if (!lhs && src[index].src === 'fn') {
      index++;
      let pattern: AbstractSyntaxTree;
      [index, pattern] = parsePattern(0, ['{', '->'], ['\n'])(src, index);
      const token = src[index]?.src;

      if (token === '{') {
        index++;
        brackets++;
        if (src[index]?.type === 'newline') index++;
        let sequence: AbstractSyntaxTree;
        followSet.push('}');
        [index, sequence] = parseSequence(src, index, ['}']);
        followSet.pop();

        const node = () => {
          const node = fn(pattern, sequence, { position: nodePosition() });
          node.data.precedence = [null, null];
          return node;
        };

        if (src[index]?.type === 'newline') index++;
        if (src[index]?.src !== '}') {
          return [
            index,
            error(SystemError.missingToken(nodePosition(), '}'), node()),
          ];
        }

        brackets--;
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
      const token = src[index]?.src;

      if (token === '{') {
        index++;
        brackets++;
        if (src[index]?.type === 'newline') index++;
        let sequence: AbstractSyntaxTree;
        followSet.push('}');
        [index, sequence] = parseSequence(src, index, ['}']);
        followSet.pop();

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
        if (src[index]?.type === 'newline') index++;
        if (src[index]?.src !== '}') {
          return [
            index,
            error(SystemError.missingToken(nodePosition(), '}'), node()),
          ];
        }
        brackets--;
        index++;

        if (src[index]?.src === 'else') {
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

        if (src[_index]?.src !== 'else') {
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
      const token = src[index]?.src;

      if (token === '{') {
        index++;
        brackets++;
        if (src[index]?.type === 'newline') index++;

        let sequence: AbstractSyntaxTree;
        followSet.push('}');
        [index, sequence] = parseSequence(src, index, ['}']);
        followSet.pop();
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
        if (src[index]?.type === 'newline') index++;
        if (src[index]?.src !== '}') {
          return [
            index,
            error(SystemError.missingToken(nodePosition(), '}'), node()),
          ];
        }
        brackets--;
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

    if (!lhs && src[index].src === 'import') {
      index++;
      const nameToken = src[index];
      if (nameToken?.type !== 'string') {
        return [index, operator(OperatorType.IMPORT, nodePosition())];
      }
      index++;
      const name = nameToken.value;
      let pattern: AbstractSyntaxTree | null = null;
      const node = () => {
        const node = operator(OperatorType.IMPORT, nodePosition());
        node.data.name = name;
        if (pattern) node.children.push(pattern);
        node.data.precedence = [null, null];
        return node;
      };

      if (src[index]?.src === 'as') {
        index++;
        [index, pattern] = parsePattern(0)(src, index);
      }

      return [index, node()];
    }

    if (!lhs && src[index].src === 'for') {
      index++;
      if (src[index]?.type === 'newline') index++;
      let pattern: AbstractSyntaxTree;
      [index, pattern] = parsePattern(0, ['in'])(src, index);

      const hasInKeyword = src[index]?.src === 'in';
      const inKeywordPosition = mapListPosToPos(indexPosition(index), src);
      if (hasInKeyword) index++;
      let expr: AbstractSyntaxTree;
      [index, expr] = parseExpr(0, ['{'])(src, index);

      const hasOpeningBracket = ['{', ':', '\n'].includes(src[index]?.src);
      const openingBracketPosition = mapListPosToPos(indexPosition(index), src);
      if (hasOpeningBracket) index++;
      brackets++;

      let sequence: AbstractSyntaxTree;
      followSet.push('}');
      [index, sequence] = parseSequence(src, index, ['}']);
      followSet.pop();

      const node = () => {
        let node = operator(
          OperatorType.FOR,
          nodePosition(),
          pattern,
          expr,
          sequence
        );
        node.data.precedence = [null, null];

        if (!hasInKeyword)
          node = error(SystemError.missingToken(inKeywordPosition, 'in'), node);

        if (!hasOpeningBracket)
          node = error(
            SystemError.missingToken(openingBracketPosition, '{', ':', '\n'),
            node
          );

        return node;
      };

      if (src[index]?.type === 'newline') index++;
      if (src[index]?.src !== '}') {
        return [
          index,
          error(SystemError.missingToken(nodePosition(), '}'), node()),
        ];
      }

      brackets--;
      index++;
      return [index, node()];
    }

    if (!lhs && src[index].src === 'switch') {
      index++;
      let value: AbstractSyntaxTree;
      [index, value] = parseExpr(0, ['{'])(src, index);

      if (src[index]?.src !== '{') {
        return [
          index,
          error(
            SystemError.missingToken(nodePosition(), '{'),
            operator(OperatorType.MATCH, nodePosition(), value)
          ),
        ];
      }

      index++;
      brackets++;
      if (src[index]?.type === 'newline') index++;

      const cases: AbstractSyntaxTree[] = [];
      followSet.push('}');

      while (src[index] && src[index].src !== '}') {
        if (src[index]?.type === 'newline') index++;
        let pattern: AbstractSyntaxTree;
        [index, pattern] = parsePattern(0, ['->'])(src, index);
        if (src[index]?.src === '->') index++;
        // else error missing ->
        if (src[index]?.type === 'newline') index++;
        let body: AbstractSyntaxTree;
        [index, body] = parseExpr(0, ['}', ','])(src, index);
        if (src[index]?.src === ',') index++;
        if (src[index]?.type === 'newline') index++;
        cases.push(
          operator(OperatorType.MATCH_CASE, nodePosition(), pattern, body)
        );
      }
      followSet.pop();

      if (src[index]?.src !== '}') {
        return [
          index,
          error(
            SystemError.missingToken(nodePosition(), '}'),
            operator(OperatorType.MATCH, nodePosition(), value, ...cases)
          ),
        ];
      }

      brackets--;
      index++;
      return [
        index,
        operator(OperatorType.MATCH, nodePosition(), value, ...cases),
      ];
    }

    if (!lhs && src[index].src === 'inject') {
      index++;
      let value: AbstractSyntaxTree;
      [index, value] = parseExpr(0, ['{'])(src, index);

      if (src[index]?.src !== '{') {
        return [
          index,
          error(
            SystemError.missingToken(nodePosition(), '{'),
            operator(
              OperatorType.INJECT,
              nodePosition(),
              value,
              implicitPlaceholder(nodePosition())
            )
          ),
        ];
      }

      index++;
      brackets++;
      if (src[index]?.type === 'newline') index++;

      followSet.push('}');
      let sequence: AbstractSyntaxTree;
      [index, sequence] = parseSequence(src, index, ['}']);
      followSet.pop();

      if (src[index]?.src !== '}') {
        return [
          index,
          error(
            SystemError.missingToken(nodePosition(), '}'),
            operator(OperatorType.INJECT, nodePosition(), value, sequence)
          ),
        ];
      }

      brackets--;
      index++;
      return [
        index,
        operator(OperatorType.INJECT, nodePosition(), value, sequence),
      ];
    }

    if (!lhs && src[index].src === 'without') {
      index++;
      let value: AbstractSyntaxTree;
      [index, value] = parseExpr(0, ['{'])(src, index);

      if (src[index]?.src !== '{') {
        return [
          index,
          error(
            SystemError.missingToken(nodePosition(), '{'),
            operator(
              OperatorType.WITHOUT,
              nodePosition(),
              value,
              implicitPlaceholder(nodePosition())
            )
          ),
        ];
      }

      index++;
      brackets++;
      if (src[index]?.type === 'newline') index++;

      followSet.push('}');
      let sequence: AbstractSyntaxTree;
      [index, sequence] = parseSequence(src, index, ['}']);
      followSet.pop();

      if (src[index]?.src !== '}') {
        return [
          index,
          error(
            SystemError.missingToken(nodePosition(), '}'),
            operator(OperatorType.WITHOUT, nodePosition(), value, sequence)
          ),
        ];
      }

      brackets--;
      index++;
      return [
        index,
        operator(OperatorType.WITHOUT, nodePosition(), value, sequence),
      ];
    }

    if (!lhs && src[index].src === 'mask') {
      index++;
      let value: AbstractSyntaxTree;
      [index, value] = parseExpr(0, ['{'])(src, index);

      if (src[index]?.src !== '{') {
        return [
          index,
          error(
            SystemError.missingToken(nodePosition(), '{'),
            operator(
              OperatorType.MASK,
              nodePosition(),
              value,
              implicitPlaceholder(nodePosition())
            )
          ),
        ];
      }

      index++;
      brackets++;
      if (src[index]?.type === 'newline') index++;

      followSet.push('}');
      let sequence: AbstractSyntaxTree;
      [index, sequence] = parseSequence(src, index, ['}']);
      followSet.pop();

      if (src[index]?.src !== '}') {
        return [
          index,
          error(
            SystemError.missingToken(nodePosition(), '}'),
            operator(OperatorType.MASK, nodePosition(), value, sequence)
          ),
        ];
      }

      brackets--;
      index++;
      return [
        index,
        operator(OperatorType.MASK, nodePosition(), value, sequence),
      ];
    }

    const patternResult = parsePattern(0, banned, skip)(src, index);

    if (
      src[patternResult[0]] &&
      !lhs &&
      patternResult[1].type !== NodeType.ERROR
    ) {
      let index = patternResult[0];
      const pattern = patternResult[1];
      if (src[index].src in idToLhsPatternExprOp) {
        const op = idToLhsPatternExprOp[src[index].src];
        index++;
        return [index, operator(op, nodePosition(), pattern)];
      }
    }

    if (!lhs && src[index].src in idToPrefixExprOp) {
      const op = idToPrefixExprOp[src[index].src];
      index++;
      return [index, operator(op, nodePosition())];
    }

    if (lhs && src[index].src in idToExprOp) {
      const op = idToExprOp[src[index].src];
      index++;
      return [index, operator(op, nodePosition())];
    }

    if (!lhs && src[index].src === '|') {
      index++;
      return parseGroup(banned, skip, lhs)(src, index);
    }

    if (!lhs && src[index].src === '{') {
      index++;
      brackets++;
      if (src[index]?.type === 'newline') index++;
      let sequence: AbstractSyntaxTree;
      followSet.push('}');
      [index, sequence] = parseSequence(src, index, ['}']);
      followSet.pop();
      const node = () => block(sequence, nodePosition());

      if (src[index]?.type === 'newline') index++;
      if (src[index]?.src !== '}') {
        return [
          index,
          error(SystemError.missingToken(nodePosition(), '}'), node()),
        ];
      }
      brackets--;
      index++;
      return [index, node()];
    }

    if (src[index].src === '[') {
      index++;
      squareBrackets++;
      if (src[index]?.type === 'newline') index++;

      followSet.push(']');
      const [_index, expr] = parseExpr(0, [']'], ['\n'])(src, index);
      followSet.pop();
      index = _index;
      const node = () => operator(OperatorType.INDEX, nodePosition(), expr);

      while (tokenIncludes(src[index], ['\n'])) index++;

      if (src[index]?.src !== ']') {
        return [
          index,
          error(SystemError.missingToken(nodePosition(), ']'), node()),
        ];
      }
      squareBrackets--;
      index++;

      return [index, node()];
    }

    if (!lhs && src[index].src === '(') {
      index++;
      parens++;
      if (src[index]?.type === 'newline') index++;

      if (!src[index]) {
        return [
          index,
          error(
            SystemError.unbalancedOpenToken(
              ['(', ')'],
              nodePosition(),
              indexPosition(index)
            ),
            operator(
              OperatorType.PARENS,
              nodePosition(),
              implicitPlaceholder(nodePosition())
            )
          ),
        ];
      }

      let expr: AbstractSyntaxTree;
      followSet.push(')');
      [index, expr] = parseExpr(0, [')'], ['\n'])(src, index);
      followSet.pop();
      const node = () => operator(OperatorType.PARENS, nodePosition(), expr);

      while (tokenIncludes(src[index], ['\n'])) index++;

      if (src[index]?.src !== ')') {
        return [
          index,
          error(SystemError.missingToken(nodePosition(), ')'), node()),
        ];
      }
      parens--;
      index++;

      return [index, node()];
    }

    if (src[index].src === '.') {
      index++;
      const next = src[index];
      if (next?.type === 'identifier') {
        index++;
        const key = string(next.src, { start: next.start, end: next.end });
        return [index, operator(OperatorType.INDEX, nodePosition(), key)];
      }
      return [
        index,
        error(SystemError.invalidIndex(nodePosition()), nodePosition()),
      ];
    }

    // if (parens !== 0 && src[index].src === ')') {
    //   return [index, implicitPlaceholder(nodePosition())];
    // }

    if (lhs) return [index, operator(OperatorType.APPLICATION, nodePosition())];

    index++;
    return [index, token(src[index - 1], nodePosition())];
  };

const parsePrefix =
  (banned: string[] = [], skip: string[] = []) =>
  (src: TokenPos[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    //skip possible whitespace prefix
    if (src[index]?.type === 'newline') index++;

    const start = index;
    const nodePosition = () => mapListPosToPos(position(start, index), src);
    if (!src[index])
      return [
        index,
        error(SystemError.endOfSource(nodePosition()), nodePosition()),
      ];

    let [nextIndex, group] = parseGroup(banned, skip)(src, index);
    index = nextIndex;
    const [, right] = group.data.precedence ?? [null, null];

    if (right !== null) {
      let rhs: AbstractSyntaxTree;
      [index, rhs] = parseExpr(right, banned, skip)(src, index);
      return [index, prefix(group, rhs)];
    }

    return [index, group];
  };

const parseExpr =
  (precedence = 0, banned: string[] = [], skip: string[] = []) =>
  (src: TokenPos[], i = 0): [index: number, ast: AbstractSyntaxTree] => {
    let index = i;
    let lhs: AbstractSyntaxTree;
    [index, lhs] = parsePrefix(banned, skip)(src, index);
    const until = () => {
      return banned.length === 0 || !tokenIncludes(src[index], banned);
    };

    while (src[index] && until()) {
      let [nextIndex, opGroup] = parseGroup(
        banned,
        [...skip, '\n'],
        true
      )(src, index);
      const [left, right] = opGroup.data.precedence ?? [null, null];
      if (left === null) break;
      if (left <= precedence) break;
      index = nextIndex;

      if (right === null) {
        lhs = postfix(opGroup, lhs);
        continue;
      }

      let rhs: AbstractSyntaxTree;
      [index, rhs] = parseExpr(right, banned, skip)(src, index);

      // if two same operators are next to each other, and their precedence is the same on both sides
      // so it is both left and right associative
      // which means we can put all arguments into one group
      const associative = left === right;
      const hasSameOperator = opGroup.data.operator === lhs.data.operator;
      const isPlaceholder = rhs.type === NodeType.IMPLICIT_PLACEHOLDER;
      if (associative && hasSameOperator && !isPlaceholder) {
        lhs.children.push(rhs);
      } else {
        lhs = infix(opGroup, lhs, rhs);
      }
    }

    return [index, lhs];
  };

const parseSequence = (
  src: TokenPos[],
  i: number,
  banned: string[] = []
): [index: number, ast: AbstractSyntaxTree] => {
  let index = i;
  const start = index;
  const nodePosition = () => mapListPosToPos(position(start, index), src);
  const children: AbstractSyntaxTree[] = [];

  while (
    src[index] &&
    (banned.length === 0 || !tokenIncludes(src[index], banned)) &&
    (followSet.length === 0 || !tokenIncludes(src[index], followSet))
  ) {
    if (tokenIncludes(src[index], ['\n', ';'])) {
      index++;
      continue;
    }
    let node: AbstractSyntaxTree;
    [index, node] = parseExpr(0, [';', ...banned])(src, index);
    children.push(node);
  }

  return [index, operator(OperatorType.SEQUENCE, nodePosition(), ...children)];
};

const parseDeclaration = (
  src: TokenPos[],
  i = 0
): [index: number, ast: AbstractSyntaxTree] => {
  return parseExpr(0, [';'])(src, i);
};

export const parseScript = (src: TokenPos[], i = 0): AbstractSyntaxTree => {
  const [_, sequence] = parseSequence(src, i);
  return script(sequence.children);
};

export const parseModule = (src: TokenPos[], i = 0): AbstractSyntaxTree => {
  const children: AbstractSyntaxTree[] = [];
  let index = i;

  while (src[index]) {
    if (tokenIncludes(src[index], ['\n', ';'])) {
      index++;
      continue;
    }
    let node: AbstractSyntaxTree;
    [index, node] = parseDeclaration(src, index);
    children.push(node);
  }

  return module(children);
};
