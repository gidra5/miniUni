import { type Token, type TokenPos } from './tokens.js';
import { SystemError } from './error.js';
import {
  indexPosition,
  position,
  mapListPosToPos,
  mergePositions,
  Position,
} from './position.js';
import {
  AbstractSyntaxTree,
  block,
  error,
  fn,
  implicitPlaceholder,
  NodeType,
  operator,
  OperatorType,
  script,
  module,
  string,
  token,
  Precedence,
  getPrecedence as getOperatorPrecedence,
} from './ast.js';
import { inject, Injectable } from './injector.js';
import { inspect } from './utils.js';

export const getPrecedence = (node: AbstractSyntaxTree): Precedence =>
  inject(Injectable.ASTNodePrecedenceMap).get(node.id) ??
  getOperatorPrecedence(node.data.operator);

export const getPosition = (node: AbstractSyntaxTree): Position => {
  const nodePosition = inject(Injectable.ASTNodePositionMap).get(node.id);
  if (nodePosition) return nodePosition;
  const childrenPosition = node.children.map(getPosition);
  return mergePositions(...childrenPosition);
};

const infix = (
  group: AbstractSyntaxTree,
  lhs: AbstractSyntaxTree,
  rhs: AbstractSyntaxTree
): AbstractSyntaxTree => {
  const { children } = group;
  return { ...group, children: [lhs, ...children, rhs] };
};

const postfix = (
  group: AbstractSyntaxTree,
  lhs: AbstractSyntaxTree
): AbstractSyntaxTree => {
  const { children } = group;
  return { ...group, children: [lhs, ...children] };
};

const prefix = (
  group: AbstractSyntaxTree,
  rhs: AbstractSyntaxTree
): AbstractSyntaxTree => {
  const { children } = group;
  return { ...group, children: [...children, rhs] };
};

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
  // ';': OperatorType.SEQUENCE,
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
      return [index, operator(op, { position: nodePosition() })];
    }

    if (lhs && src[index].src in idToPatternOp) {
      const op = idToPatternOp[src[index].src];
      index++;
      return [index, operator(op)];
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
        const node = operator(OperatorType.OBJECT, {
          position: nodePosition(),
        });
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
      const node = () =>
        operator(OperatorType.PARENS, {
          position: nodePosition(),
          children: [pattern],
        });

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
      const node = () =>
        operator(OperatorType.INDEX, {
          position: nodePosition(),
          children: [pattern],
        });

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
    const [, right] = getPrecedence(group) ?? [null, null];

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
      const [left, right] = getPrecedence(group) ?? [null, null];
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
          inject(Injectable.ASTNodePrecedenceMap).set(node.id, [null, null]);
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
          operator(OperatorType.FUNCTION, {
            position: nodePosition(),
            children: [pattern],
          }),
        ];
      }

      return [
        index,
        error(
          SystemError.missingToken(nodePosition(), '->', '{'),
          operator(OperatorType.FUNCTION, {
            position: nodePosition(),
            children: [pattern],
          })
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
          const node = operator(OperatorType.IF, {
            position: nodePosition(),
            children: [condition, sequence],
          });
          inject(Injectable.ASTNodePrecedenceMap).set(node.id, [null, null]);
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
            operator(OperatorType.IF_ELSE, {
              position: nodePosition(),
              children: [condition, sequence],
            }),
          ];
        }

        return [index, node()];
      }

      if (token === ':' || token.includes('\n')) {
        index++;
        const [_index, body] = parseExpr(0, ['else'])(src, index);

        if (src[_index]?.src !== 'else') {
          return [
            index,
            operator(OperatorType.IF, {
              position: nodePosition(),
              children: [condition],
            }),
          ];
        }

        index = _index + 1;
        return [
          index,
          operator(OperatorType.IF_ELSE, {
            position: nodePosition(),
            children: [condition, body],
          }),
        ];
      }

      return [
        index,
        error(
          SystemError.missingToken(nodePosition(), ':', '\\n', '{'),
          operator(OperatorType.IF, {
            position: nodePosition(),
            children: [condition],
          })
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
          const node = operator(OperatorType.WHILE, {
            position: nodePosition(),
            children: [condition, sequence],
          });
          inject(Injectable.ASTNodePrecedenceMap).set(node.id, [null, null]);
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
        return [
          index,
          operator(OperatorType.WHILE, {
            position: nodePosition(),
            children: [condition],
          }),
        ];
      }

      return [
        index,
        error(
          SystemError.missingToken(nodePosition(), ':', '\\n', '{'),
          operator(OperatorType.WHILE, {
            position: nodePosition(),
            children: [condition],
          })
        ),
      ];
    }

    if (!lhs && src[index].src === 'import') {
      index++;
      const nameToken = src[index];
      if (nameToken?.type !== 'string') {
        return [
          index,
          operator(OperatorType.IMPORT, { position: nodePosition() }),
        ];
      }
      index++;
      const name = nameToken.value;
      let pattern: AbstractSyntaxTree | null = null;
      const node = () => {
        const node = operator(OperatorType.IMPORT, {
          position: nodePosition(),
        });
        node.data.name = name;
        if (pattern) node.children.push(pattern);
        inject(Injectable.ASTNodePrecedenceMap).set(node.id, [null, null]);
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
        let node = operator(OperatorType.FOR, {
          position: nodePosition(),
          children: [pattern, expr, sequence],
        });
        inject(Injectable.ASTNodePrecedenceMap).set(node.id, [null, null]);

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
      const cases: AbstractSyntaxTree[] = [];
      const node = () =>
        operator(OperatorType.MATCH, {
          position: nodePosition(),
          children: [value, ...cases],
        });

      if (src[index]?.src !== '{') {
        return [
          index,
          error(SystemError.missingToken(nodePosition(), '{'), node()),
        ];
      }

      index++;
      brackets++;
      if (src[index]?.type === 'newline') index++;

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

        const options = { children: [pattern, body] };
        const node = operator(OperatorType.MATCH_CASE, options);
        cases.push(node);
      }
      followSet.pop();

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

    if (!lhs && src[index].src === 'inject') {
      index++;
      let value: AbstractSyntaxTree;
      [index, value] = parseExpr(0, ['{'])(src, index);

      if (src[index]?.src !== '{') {
        return [
          index,
          error(
            SystemError.missingToken(nodePosition(), '{'),
            operator(OperatorType.INJECT, {
              position: nodePosition(),
              children: [value, implicitPlaceholder(nodePosition())],
            })
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
            operator(OperatorType.INJECT, {
              position: nodePosition(),
              children: [value, sequence],
            })
          ),
        ];
      }

      brackets--;
      index++;
      return [
        index,
        operator(OperatorType.INJECT, {
          position: nodePosition(),
          children: [value, sequence],
        }),
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
            operator(OperatorType.WITHOUT, {
              position: nodePosition(),
              children: [value, implicitPlaceholder(nodePosition())],
            })
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
            operator(OperatorType.WITHOUT, {
              position: nodePosition(),
              children: [value, sequence],
            })
          ),
        ];
      }

      brackets--;
      index++;
      return [
        index,
        operator(OperatorType.WITHOUT, {
          position: nodePosition(),
          children: [value, sequence],
        }),
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
            operator(OperatorType.MASK, {
              position: nodePosition(),
              children: [value, implicitPlaceholder(nodePosition())],
            })
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
            operator(OperatorType.MASK, {
              position: nodePosition(),
              children: [value, sequence],
            })
          ),
        ];
      }

      brackets--;
      index++;
      return [
        index,
        operator(OperatorType.MASK, {
          position: nodePosition(),
          children: [value, sequence],
        }),
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
        return [
          index,
          operator(op, { position: nodePosition(), children: [pattern] }),
        ];
      }
    }

    if (!lhs && src[index].src in idToPrefixExprOp) {
      const op = idToPrefixExprOp[src[index].src];
      index++;
      return [index, operator(op, { position: nodePosition() })];
    }

    if (lhs && src[index].src in idToExprOp) {
      const op = idToExprOp[src[index].src];
      index++;
      return [index, operator(op)];
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
      const node = () =>
        operator(lhs ? OperatorType.INDEX : OperatorType.SQUARE_BRACKETS, {
          position: nodePosition(),
          children: [expr],
        });

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
            operator(OperatorType.PARENS, {
              position: nodePosition(),
              children: [implicitPlaceholder(nodePosition())],
            })
          ),
        ];
      }

      let expr: AbstractSyntaxTree;
      followSet.push(')');
      [index, expr] = parseExpr(0, [')'], ['\n'])(src, index);
      followSet.pop();
      const node = () =>
        operator(OperatorType.PARENS, {
          position: nodePosition(),
          children: [expr],
        });

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
        return [
          index,
          operator(OperatorType.INDEX, {
            position: nodePosition(),
            children: [key],
          }),
        ];
      }
      return [
        index,
        error(SystemError.invalidIndex(nodePosition()), nodePosition()),
      ];
    }

    // if (parens !== 0 && src[index].src === ')') {
    //   return [index, implicitPlaceholder(nodePosition())];
    // }

    if (lhs) return [index, operator(OperatorType.APPLICATION)];

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
    const [, right] = getPrecedence(group) ?? [null, null];

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
      const [left, right] = getPrecedence(opGroup) ?? [null, null];
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
  // return parseExpr(0, banned)(src, i);
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

  if (children.length === 1) return [index, children[0]];
  if (children.length === 0)
    return [index, implicitPlaceholder(nodePosition())];

  return [index, operator(OperatorType.SEQUENCE, { children })];
};

const parseDeclaration = (
  src: TokenPos[],
  i = 0
): [index: number, ast: AbstractSyntaxTree] => {
  return parseExpr(0, [';'])(src, i);
};

export const parseScript = (src: TokenPos[], i = 0): AbstractSyntaxTree => {
  const [_, sequence] = parseSequence(src, i);
  if (sequence.data.operator === OperatorType.SEQUENCE)
    return script(sequence.children);
  return script([sequence]);
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
