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
  Tree,
  block,
  error,
  fn,
  implicitPlaceholder,
  NodeType,
  node as _node,
  OperatorNodeType,
  script,
  module,
  string,
  token,
  Precedence,
  getExprPrecedence as _getExprPrecedence,
  getPatternPrecedence as _getPatternPrecedence,
  ExpressionNode,
  sequence,
  ExportNode,
  ImportNode,
  DeclarationPatternNode,
  ErrorNode,
} from './ast.js';
import { inject, Injectable } from './injector.js';

export const getExprPrecedence = (node: Tree): Precedence =>
  inject(Injectable.ASTNodePrecedenceMap).get(node.id) ??
  _getExprPrecedence(node.type);

export const getPatternPrecedence = (node: Tree): Precedence =>
  inject(Injectable.ASTNodePrecedenceMap).get(node.id) ??
  _getPatternPrecedence(node.type);

export const getPosition = (node: Tree): Position => {
  const map = inject(Injectable.ASTNodePositionMap);
  if (map.has(node.id)) return map.get(node.id)!;
  const childrenPosition = node.children.map(getPosition);
  return mergePositions(...childrenPosition);
};

const infix = (group: Tree, lhs: Tree, rhs: Tree): Tree => {
  const { children } = group;
  return { ...group, children: [lhs, ...children, rhs] };
};

const postfix = (group: Tree, lhs: Tree): Tree => {
  const { children } = group;
  return { ...group, children: [lhs, ...children] };
};

const prefix = (group: Tree, rhs: Tree): Tree => {
  const { children } = group;
  return { ...group, children: [...children, rhs] };
};

const idToExprOp = {
  '+': OperatorNodeType.ADD,
  '-': OperatorNodeType.SUB,
  '*': OperatorNodeType.MULT,
  '/': OperatorNodeType.DIV,
  '%': OperatorNodeType.MOD,
  '^': OperatorNodeType.POW,
  '==': OperatorNodeType.EQUAL,
  '!=': OperatorNodeType.NOT_EQUAL,
  '===': OperatorNodeType.DEEP_EQUAL,
  '!==': OperatorNodeType.DEEP_NOT_EQUAL,
  '<': OperatorNodeType.LESS,
  '<=': OperatorNodeType.LESS_EQUAL,
  '>': OperatorNodeType.GREATER,
  '>=': OperatorNodeType.GREATER_EQUAL,
  '++': OperatorNodeType.POST_INCREMENT,
  '--': OperatorNodeType.POST_DECREMENT,
  '->': OperatorNodeType.FUNCTION,
  ',': OperatorNodeType.TUPLE,
  ':': OperatorNodeType.COLON,
  // ';': OperatorType.SEQUENCE,
  '<-': OperatorNodeType.SEND,
  '?<-': OperatorNodeType.SEND_STATUS,
  '|': OperatorNodeType.PARALLEL,
  and: OperatorNodeType.AND,
  or: OperatorNodeType.OR,
  is: OperatorNodeType.IS,
  in: OperatorNodeType.IN,
};

const idToPrefixExprOp = {
  '!': OperatorNodeType.NOT,
  '-': OperatorNodeType.MINUS,
  '+': OperatorNodeType.PLUS,
  '++': OperatorNodeType.INCREMENT,
  '--': OperatorNodeType.DECREMENT,
  '...': OperatorNodeType.SPREAD,
  ':': OperatorNodeType.ATOM,
  '<-': OperatorNodeType.RECEIVE,
  '<-?': OperatorNodeType.RECEIVE_STATUS,
  not: OperatorNodeType.NOT,
  async: OperatorNodeType.FORK,
  loop: OperatorNodeType.LOOP,
  export: OperatorNodeType.EXPORT,
};

const idToLhsPatternExprOp = {
  '->': OperatorNodeType.FUNCTION,
  ':=': OperatorNodeType.DECLARE,
  '=': OperatorNodeType.ASSIGN,
  '+=': OperatorNodeType.INC_ASSIGN,
};

const idToPatternOp = {
  ',': OperatorNodeType.TUPLE,
  '=': OperatorNodeType.ASSIGN,
  ':': OperatorNodeType.COLON,
};

const idToPrefixPatternOp = {
  '...': OperatorNodeType.SPREAD,
  ':': OperatorNodeType.ATOM,
  export: OperatorNodeType.EXPORT,
  mut: NodeType.MUTABLE,
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
  (src: TokenPos[], i = 0): [index: number, ast: Tree] => {
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
      return [index, _node(op, { position: nodePosition() })];
    }

    if (lhs && src[index].src in idToPatternOp) {
      const op = idToPatternOp[src[index].src];
      index++;
      return [index, _node(op)];
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
        const node = _node(NodeType.RECORD, {
          position: nodePosition(),
        });
        if (pattern.type === OperatorNodeType.TUPLE) {
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
        _node(OperatorNodeType.PARENS, {
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
        _node(OperatorNodeType.INDEX, {
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
  (src: TokenPos[], i = 0): [index: number, ast: Tree] => {
    let index = i;
    let group: Tree;
    [index, group] = parsePatternGroup(banned, skip)(src, index);
    const [, right] = getExprPrecedence(group) ?? [null, null];

    if (right !== null) {
      let rhs: Tree;
      [index, rhs] = parsePattern(right, banned, skip)(src, index);
      return [index, prefix(group, rhs)];
    }

    return [index, group];
  };

const parsePattern =
  (precedence = 0, banned: string[] = [], skip: string[] = []) =>
  (src: TokenPos[], i = 0): [index: number, ast: Tree] => {
    let index = i;
    let lhs: Tree;
    [index, lhs] = parsePatternPrefix(banned, skip)(src, index);

    while (src[index] && !tokenIncludes(src[index], ['\n'])) {
      let [nextIndex, group] = parsePatternGroup(
        banned,
        skip,
        true
      )(src, index);
      const [left, right] = getExprPrecedence(group) ?? [null, null];
      if (left === null) break;
      if (left <= precedence) break;
      index = nextIndex;

      if (right === null) {
        lhs = postfix(group, lhs);
        continue;
      }

      let rhs: Tree;
      [index, rhs] = parsePattern(right, banned, skip)(src, index);

      // if two same operators are next to each other, and their precedence is the same on both sides - it is both left and right associative
      // which means we can put all arguments into one group
      if (left === right && group.type === lhs.type) {
        lhs.children.push(rhs);
      } else {
        lhs = infix(group, lhs, rhs);
      }
    }

    return [index, lhs];
  };

const parseGroup =
  (banned: string[] = [], skip: string[] = [], lhs = false) =>
  (src: TokenPos[], i = 0): [index: number, ast: Tree] => {
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
      let pattern: Tree;
      [index, pattern] = parsePattern(0, ['{', '->'], ['\n'])(src, index);
      const token = src[index]?.src;

      if (token === '{') {
        index++;
        brackets++;
        if (src[index]?.type === 'newline') index++;
        let sequence: Tree;
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
          _node(OperatorNodeType.FUNCTION, {
            position: nodePosition(),
            children: [pattern],
          }),
        ];
      }

      return [
        index,
        error(
          SystemError.missingToken(nodePosition(), '->', '{'),
          _node(OperatorNodeType.FUNCTION, {
            position: nodePosition(),
            children: [pattern],
          })
        ),
      ];
    }

    if (!lhs && src[index].src === 'if') {
      index++;
      let condition: Tree;
      [index, condition] = parseExpr(0, [':', '\n', '{'])(src, index);
      const token = src[index]?.src;

      if (token === '{') {
        index++;
        brackets++;
        if (src[index]?.type === 'newline') index++;
        let sequence: Tree;
        followSet.push('}');
        [index, sequence] = parseSequence(src, index, ['}']);
        followSet.pop();

        const node = () => {
          const node = _node(OperatorNodeType.IF, {
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
            _node(OperatorNodeType.IF_ELSE, {
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
            _node(OperatorNodeType.IF, {
              position: nodePosition(),
              children: [condition],
            }),
          ];
        }

        index = _index + 1;
        return [
          index,
          _node(OperatorNodeType.IF_ELSE, {
            position: nodePosition(),
            children: [condition, body],
          }),
        ];
      }

      return [
        index,
        error(
          SystemError.missingToken(nodePosition(), ':', '\\n', '{'),
          _node(OperatorNodeType.IF, {
            position: nodePosition(),
            children: [condition],
          })
        ),
      ];
    }

    if (!lhs && src[index].src === 'while') {
      index++;
      let condition: Tree;
      [index, condition] = parseExpr(0, [':', '\n', '{'])(src, index);
      const token = src[index]?.src;

      if (token === '{') {
        index++;
        brackets++;
        if (src[index]?.type === 'newline') index++;

        let sequence: Tree;
        followSet.push('}');
        [index, sequence] = parseSequence(src, index, ['}']);
        followSet.pop();
        const node = () => {
          const node = _node(OperatorNodeType.WHILE, {
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
          _node(OperatorNodeType.WHILE, {
            position: nodePosition(),
            children: [condition],
          }),
        ];
      }

      return [
        index,
        error(
          SystemError.missingToken(nodePosition(), ':', '\\n', '{'),
          _node(OperatorNodeType.WHILE, {
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
          _node(OperatorNodeType.IMPORT, { position: nodePosition() }),
        ];
      }
      index++;
      const name = nameToken.value;
      let pattern: Tree | null = null;
      const node = () => {
        const node = _node(OperatorNodeType.IMPORT, {
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
      let pattern: Tree;
      [index, pattern] = parsePattern(0, ['in'])(src, index);

      const hasInKeyword = src[index]?.src === 'in';
      const inKeywordPosition = mapListPosToPos(indexPosition(index), src);
      if (hasInKeyword) index++;
      let expr: Tree;
      [index, expr] = parseExpr(0, ['{'])(src, index);

      const hasOpeningBracket = ['{', ':', '\n'].includes(src[index]?.src);
      const openingBracketPosition = mapListPosToPos(indexPosition(index), src);
      if (hasOpeningBracket) index++;
      brackets++;

      let sequence: Tree;
      followSet.push('}');
      [index, sequence] = parseSequence(src, index, ['}']);
      followSet.pop();

      const node = () => {
        let node: Tree = _node(OperatorNodeType.FOR, {
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
      let value: Tree;
      [index, value] = parseExpr(0, ['{'])(src, index);
      const cases: Tree[] = [];
      const node = () =>
        _node(OperatorNodeType.MATCH, {
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
        let pattern: Tree;
        [index, pattern] = parsePattern(0, ['->'])(src, index);
        if (src[index]?.src === '->') index++;
        // else error missing ->
        if (src[index]?.type === 'newline') index++;
        let body: Tree;
        [index, body] = parseExpr(0, ['}', ','])(src, index);
        if (src[index]?.src === ',') index++;
        if (src[index]?.type === 'newline') index++;

        const options = { children: [pattern, body] };
        const node = _node(OperatorNodeType.MATCH_CASE, options);
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
      let value: Tree;
      [index, value] = parseExpr(0, ['{'])(src, index);

      if (src[index]?.src !== '{') {
        return [
          index,
          error(
            SystemError.missingToken(nodePosition(), '{'),
            _node(OperatorNodeType.INJECT, {
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
      let sequence: Tree;
      [index, sequence] = parseSequence(src, index, ['}']);
      followSet.pop();

      if (src[index]?.src !== '}') {
        return [
          index,
          error(
            SystemError.missingToken(nodePosition(), '}'),
            _node(OperatorNodeType.INJECT, {
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
        _node(OperatorNodeType.INJECT, {
          position: nodePosition(),
          children: [value, sequence],
        }),
      ];
    }

    if (!lhs && src[index].src === 'without') {
      index++;
      let value: Tree;
      [index, value] = parseExpr(0, ['{'])(src, index);

      if (src[index]?.src !== '{') {
        return [
          index,
          error(
            SystemError.missingToken(nodePosition(), '{'),
            _node(OperatorNodeType.WITHOUT, {
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
      let sequence: Tree;
      [index, sequence] = parseSequence(src, index, ['}']);
      followSet.pop();

      if (src[index]?.src !== '}') {
        return [
          index,
          error(
            SystemError.missingToken(nodePosition(), '}'),
            _node(OperatorNodeType.WITHOUT, {
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
        _node(OperatorNodeType.WITHOUT, {
          position: nodePosition(),
          children: [value, sequence],
        }),
      ];
    }

    if (!lhs && src[index].src === 'mask') {
      index++;
      let value: Tree;
      [index, value] = parseExpr(0, ['{'])(src, index);

      if (src[index]?.src !== '{') {
        return [
          index,
          error(
            SystemError.missingToken(nodePosition(), '{'),
            _node(OperatorNodeType.MASK, {
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
      let sequence: Tree;
      [index, sequence] = parseSequence(src, index, ['}']);
      followSet.pop();

      if (src[index]?.src !== '}') {
        return [
          index,
          error(
            SystemError.missingToken(nodePosition(), '}'),
            _node(OperatorNodeType.MASK, {
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
        _node(OperatorNodeType.MASK, {
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
          _node(op, { position: nodePosition(), children: [pattern] }),
        ];
      }
    }

    if (!lhs && src[index].src in idToPrefixExprOp) {
      const op = idToPrefixExprOp[src[index].src];
      index++;
      return [index, _node(op, { position: nodePosition() })];
    }

    if (lhs && src[index].src in idToExprOp) {
      const op = idToExprOp[src[index].src];
      index++;
      return [index, _node(op)];
    }

    if (!lhs && src[index].src === '|') {
      index++;
      return parseGroup(banned, skip, lhs)(src, index);
    }

    if (!lhs && src[index].src === '{') {
      index++;
      brackets++;
      if (src[index]?.type === 'newline') index++;
      let sequence: Tree;
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
        _node(lhs ? OperatorNodeType.INDEX : OperatorNodeType.SQUARE_BRACKETS, {
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
            _node(OperatorNodeType.PARENS, {
              position: nodePosition(),
              children: [implicitPlaceholder(nodePosition())],
            })
          ),
        ];
      }

      let expr: Tree;
      followSet.push(')');
      [index, expr] = parseExpr(0, [')'], ['\n'])(src, index);
      followSet.pop();
      const node = () =>
        _node(OperatorNodeType.PARENS, {
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
          _node(OperatorNodeType.INDEX, {
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

    if (lhs) return [index, _node(OperatorNodeType.APPLICATION)];

    index++;
    return [index, token(src[index - 1], nodePosition())];
  };

const parsePrefix =
  (banned: string[] = [], skip: string[] = []) =>
  (src: TokenPos[], i = 0): [index: number, ast: Tree] => {
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
    const [, right] = getExprPrecedence(group) ?? [null, null];

    if (right !== null) {
      let rhs: Tree;
      [index, rhs] = parseExpr(right, banned, skip)(src, index);
      return [index, prefix(group, rhs)];
    }

    return [index, group];
  };

const parseExpr =
  (precedence = 0, banned: string[] = [], skip: string[] = []) =>
  (src: TokenPos[], i = 0): [index: number, ast: ExpressionNode] => {
    let index = i;
    let lhs: Tree;
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
      const [left, right] = getExprPrecedence(opGroup) ?? [null, null];
      if (left === null) break;
      if (left <= precedence) break;
      index = nextIndex;

      if (right === null) {
        lhs = postfix(opGroup, lhs);
        continue;
      }

      let rhs: ExpressionNode;
      [index, rhs] = parseExpr(right, banned, skip)(src, index);

      // if two same operators are next to each other, and their precedence is the same on both sides
      // so it is both left and right associative
      // which means we can put all arguments into one group
      const associative = left === right;
      const hasSameOperator = opGroup.type === lhs.type;
      const isPlaceholder = rhs.type === NodeType.IMPLICIT_PLACEHOLDER;
      if (associative && hasSameOperator && !isPlaceholder) {
        lhs.children.push(rhs);
      } else {
        lhs = infix(opGroup, lhs, rhs);
      }
    }

    return [index, lhs as ExpressionNode];
  };

const parseSequence = (
  src: TokenPos[],
  i: number,
  banned: string[] = []
): [index: number, ast: ExpressionNode] => {
  // return parseExpr(0, banned)(src, i);
  let index = i;
  const start = index;
  const nodePosition = () => mapListPosToPos(position(start, index), src);
  const children: ExpressionNode[] = [];

  while (
    src[index] &&
    (banned.length === 0 || !tokenIncludes(src[index], banned)) &&
    (followSet.length === 0 || !tokenIncludes(src[index], followSet))
  ) {
    if (tokenIncludes(src[index], ['\n', ';'])) {
      index++;
      continue;
    }
    let node: ExpressionNode;
    [index, node] = parseExpr(0, [';', ...banned])(src, index);
    children.push(node);
  }

  if (children.length === 1) return [index, children[0]];
  if (children.length === 0)
    return [index, implicitPlaceholder(nodePosition())];

  return [index, sequence(children)];
};

const parseDeclaration = (
  src: TokenPos[],
  i = 0
): [index: number, ast: ImportNode | DeclarationPatternNode | ExportNode] => {
  return parseExpr(0, [';'])(src, i) as unknown as [
    index: number,
    ast: ImportNode | DeclarationPatternNode | ExportNode
  ];
};

export const parseScript = (src: TokenPos[], i = 0) => {
  const [_, sequence] = parseSequence(src, i);
  if (sequence.type === OperatorNodeType.SEQUENCE)
    return script(sequence.children);
  return script([sequence]);
};

export const parseModule = (src: TokenPos[], i = 0) => {
  const children: (ImportNode | DeclarationPatternNode | ErrorNode)[] = [];
  let lastExport: ExportNode | null = null;
  let index = i;

  while (src[index]) {
    if (tokenIncludes(src[index], ['\n', ';'])) {
      index++;
      continue;
    }
    let node: ImportNode | DeclarationPatternNode | ExportNode;
    [index, node] = parseDeclaration(src, index);
    if (node.type === NodeType.EXPORT) {
      if (lastExport) {
        const errorNode = error(
          SystemError.duplicateDefaultExport(getPosition(lastExport)),
          lastExport
        );
        children.push(errorNode);
      }
      lastExport = node as ExportNode;
    } else children.push(node);
  }

  if (lastExport) return module([...children, lastExport]);
  return module(children);
};
