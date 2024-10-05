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
  script,
  module,
  string,
  token,
  Precedence,
  getExprPrecedence as _getExprPrecedence,
  getPatternPrecedence as _getPatternPrecedence,
  ExpressionNode,
  ExportNode,
  ImportNode,
  DeclarationPatternNode,
  ErrorNode,
} from './ast.js';
import { inject, Injectable } from './injector.js';
import { EvalContext as EvalContext } from './evaluate/index.js';
import { Diagnostic, primaryDiagnosticLabel } from 'codespan-napi';

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

export const showPos = (
  position: Position,
  context: EvalContext,
  msg: string = ''
) => {
  const diag = Diagnostic.note();

  diag.withLabels([
    primaryDiagnosticLabel(context.fileId, {
      message: msg,
      start: position.start,
      end: position.end,
    }),
  ]);
  const fileMap = inject(Injectable.FileMap);
  diag.emitStd(fileMap);
};

export const showNode = (node: Tree, context: EvalContext, msg: string = '') =>
  showPos(getPosition(node), context, msg);

const idToExprOp = {
  '+': NodeType.ADD,
  '-': NodeType.SUB,
  '*': NodeType.MULT,
  '/': NodeType.DIV,
  '%': NodeType.MOD,
  '^': NodeType.POW,
  '==': NodeType.EQUAL,
  '!=': NodeType.NOT_EQUAL,
  '===': NodeType.DEEP_EQUAL,
  '!==': NodeType.DEEP_NOT_EQUAL,
  '<': NodeType.LESS,
  '<=': NodeType.LESS_EQUAL,
  '>': NodeType.GREATER,
  '>=': NodeType.GREATER_EQUAL,
  '++': NodeType.POST_INCREMENT,
  '--': NodeType.POST_DECREMENT,
  '?': NodeType.TRY,
  '->': NodeType.FUNCTION,
  ',': NodeType.TUPLE,
  ':': NodeType.LABEL,
  ';': NodeType.SEQUENCE,
  '<-': NodeType.SEND,
  '?<-': NodeType.SEND_STATUS,
  '|': NodeType.PARALLEL,
  '|>': NodeType.PIPE,
  and: NodeType.AND,
  or: NodeType.OR,
  in: NodeType.IN,
};

const idToPrefixExprOp = {
  '!': NodeType.NOT,
  '-': NodeType.MINUS,
  '+': NodeType.PLUS,
  '++': NodeType.INCREMENT,
  '--': NodeType.DECREMENT,
  '...': NodeType.SPREAD,
  '<-': NodeType.RECEIVE,
  '<-?': NodeType.RECEIVE_STATUS,
  not: NodeType.NOT,
  async: NodeType.ASYNC,
  await: NodeType.AWAIT,
  loop: NodeType.LOOP,
  export: NodeType.EXPORT,
};

const idToLhsPatternExprOp = {
  '->': NodeType.FUNCTION,
  ':=': NodeType.DECLARE,
  '=': NodeType.ASSIGN,
  '+=': NodeType.INC_ASSIGN,
};

const idToPatternOp = {
  ',': NodeType.TUPLE,
  ':': NodeType.LABEL,
  '@': NodeType.BIND,
};

const idToPrefixPatternOp = {
  '...': NodeType.SPREAD,
  ':': NodeType.ATOM,
  export: NodeType.EXPORT,
  mut: NodeType.MUTABLE,
  like: NodeType.LIKE,
  strict: NodeType.STRICT,
  not: NodeType.NOT,
  '!': NodeType.NOT,
};

const tokenIncludes = (token: Token | undefined, tokens: string[]): boolean =>
  !!token &&
  (tokens.includes(token.src) ||
    (tokens.includes('\n') && token.type === 'newline'));

type Context = {
  lhs: boolean;
  allowPatternDefault: boolean;
  followSet: string[];
  banned: string[];
  skip: string[];
};

const newContext = (): Context => ({
  lhs: false,
  allowPatternDefault: false,
  followSet: [],
  banned: [],
  skip: [],
});

type Parser<T = Tree> = (src: TokenPos[], i: number) => [index: number, ast: T];
type ContextParser<T = Tree> = (context: Context) => Parser<T>;

const parseValue: Parser = (src, i) => {
  let index = i;
  const start = index;
  const nodePosition = () => mapListPosToPos(position(start, index), src);

  if (src[index].src === ':') {
    index++;

    if (!src[index]) {
      return [
        index,
        error(SystemError.endOfSource(nodePosition()), nodePosition()),
      ];
    }

    const name = src[index];
    if (name.type !== 'identifier') {
      return [
        index,
        error(SystemError.invalidPattern(nodePosition()), nodePosition()),
      ];
    }

    index++;
    return [
      index,
      _node(NodeType.ATOM, {
        data: { name: name.src },
        position: nodePosition(),
      }),
    ];
  }

  if (src[index].type === 'identifier' && src[index + 1]?.src === '::') {
    return [
      index + 2,
      _node(NodeType.CODE_LABEL, {
        position: nodePosition(),
        data: { name: src[index].src },
      }),
    ];
  }

  index++;
  return [index, token(src[index - 1], nodePosition())];
};

const parsePairGroup =
  (
    context: Context,
    [left, right]: [string, string],
    parseInner: ContextParser,
    node: (ast: Tree) => Tree
  ): Parser =>
  (src, i) => {
    let index = i;
    const start = index;
    const nodePosition = () => mapListPosToPos(position(start, index), src);
    index++;

    if (src[index]?.type === 'newline') index++;
    if (!src[index]) {
      return [
        index,
        error(
          SystemError.unbalancedOpenToken(
            [left, right],
            nodePosition(),
            indexPosition(index)
          ),
          node(implicitPlaceholder(nodePosition()))
        ),
      ];
    }

    let ast: Tree;
    [index, ast] = parseInner({
      ...context,
      followSet: [...context.followSet, right],
    })(src, index);

    if (src[index]?.src !== right) {
      return [
        index,
        error(SystemError.missingToken(nodePosition(), right), node(ast)),
      ];
    }
    index++;

    return [index, node(ast)];
  };

const parseStatementForm =
  (
    context: Context,
    parseInner: ContextParser,
    node: (inner: Tree, ast?: Tree) => Tree
  ) =>
  (src: TokenPos[], i: number): [index: number, ast: Tree] => {
    let index = i;
    const start = index;
    const nodePosition = () => mapListPosToPos(position(start, index), src);
    let inner: Tree;
    [index, inner] = parseInner({
      ...context,
      banned: ['do', '->', '{'],
    })(src, index);
    const token = src[index]?.src;

    if (!token)
      return [
        index,
        error(SystemError.endOfSource(nodePosition()), node(inner)),
      ];

    if (token === '{') {
      const _node = (expr: Tree) => node(inner, expr);
      return parsePairGroup(context, ['{', '}'], parseExpr, _node)(src, index);
    }

    if (token === 'do') {
      index++;
      return [index, node(inner)];
    }

    if (token === '->') {
      index++;
      const precedence = _getExprPrecedence(NodeType.SEQUENCE);
      let expr: Tree;
      [index, expr] = parsePratt(
        context,
        parseExprGroup,
        getExprPrecedence,
        precedence[1]! - 1
      )(src, index);
      return [index, node(inner, expr)];
    }

    return [
      index,
      error(
        SystemError.missingToken(nodePosition(), 'do', 'newline', '{'),
        node(inner)
      ),
    ];
  };

const parsePatternGroup: ContextParser = (context) => (src, i) => {
  let index = i;
  const start = index;
  const nodePosition = () => mapListPosToPos(position(start, index), src);

  if (!context.lhs && Object.hasOwn(idToPrefixPatternOp, src[index].src)) {
    const op = idToPrefixPatternOp[src[index].src];
    index++;
    return [index, _node(op, { position: nodePosition() })];
  }

  if (context.lhs && Object.hasOwn(idToPatternOp, src[index].src)) {
    const op = idToPatternOp[src[index].src];
    index++;
    return [index, _node(op)];
  }

  if (src[index].src === '{') {
    const node = (pattern: Tree) => {
      const node = _node(NodeType.RECORD, {
        position: nodePosition(),
      });
      if (pattern.type === NodeType.TUPLE) node.children = pattern.children;
      else node.children.push(pattern);

      return node;
    };

    return parsePairGroup(
      { ...context, allowPatternDefault: true },
      ['{', '}'],
      parsePattern,
      node
    )(src, index);
  }

  if (src[index].src === '(') {
    const node = (pattern: Tree) =>
      _node(NodeType.PARENS, { position: nodePosition(), children: [pattern] });
    return parsePairGroup(
      { ...context, allowPatternDefault: true },
      ['(', ')'],
      parsePattern,
      node
    )(src, index);
  }

  if (src[index].src === '[') {
    const node = (expr: Tree) =>
      _node(context.lhs ? NodeType.INDEX : NodeType.SQUARE_BRACKETS, {
        position: nodePosition(),
        children: [expr],
      });

    return parsePairGroup(
      { ...context },
      ['[', ']'],
      parseExpr,
      node
    )(src, index);
  }

  if (context.allowPatternDefault && context.lhs && src[index].src === '=') {
    index++;
    let value: Tree;
    [index, value] = parsePrattGroup(
      { ...context, lhs: false },
      parseExprGroup,
      getExprPrecedence
    )(src, index);
    const node = _node(NodeType.ASSIGN, {
      position: nodePosition(),
      children: [value],
    });
    const precedence = getExprPrecedence(value);
    if (precedence[0] !== null || precedence[1] !== null) {
      return [
        index,
        error(SystemError.invalidDefaultPattern(nodePosition()), node),
      ];
    }

    return [index, node];
  }

  if (!context.lhs && src[index].src === '^') {
    index++;
    let value: Tree;
    [index, value] = parsePrattGroup(
      context,
      parseExprGroup,
      getExprPrecedence
    )(src, index);
    const node = _node(NodeType.PIN, {
      position: nodePosition(),
      children: [value],
    });
    const precedence = getExprPrecedence(value);
    if (precedence[0] !== null && precedence[1] !== null) {
      return [
        index,
        error(SystemError.invalidPinPattern(nodePosition()), node),
      ];
    }

    return [index, node];
  }

  if (context.lhs && src[index].src === '.') {
    index++;
    const next = src[index];
    if (
      !tokenIncludes(next, context.followSet) &&
      next?.type === 'identifier'
    ) {
      index++;
      const key = string(next.src, { start: next.start, end: next.end });
      return [
        index,
        _node(NodeType.INDEX, {
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

  return parseValue(src, i);
};

const parseExprGroup: ContextParser = (context) => (src, i) => {
  let index = i;
  const start = index;
  const nodePosition = () => mapListPosToPos(position(start, index), src);

  if (!context.lhs && src[index].src === 'import') {
    index++;
    const nameToken = src[index];
    if (nameToken?.type !== 'string') {
      return [index, _node(NodeType.IMPORT, { position: nodePosition() })];
    }
    index++;
    const name = nameToken.value;
    let pattern: Tree | null = null;
    const node = () => {
      const node = _node(NodeType.IMPORT, {
        position: nodePosition(),
      });
      node.data.name = name;
      if (pattern) node.children.push(pattern);
      inject(Injectable.ASTNodePrecedenceMap).set(node.id, [null, null]);
      return node;
    };

    if (src[index]?.src === 'as') {
      index++;
      [index, pattern] = parsePattern({
        ...context,
      })(src, index);
    }

    return [index, node()];
  }

  if (context.lhs && src[index].src === 'is') {
    index++;

    let pattern: Tree;
    [index, pattern] = parsePattern(context)(src, index);

    return [
      index,
      _node(NodeType.IS, { position: nodePosition(), children: [pattern] }),
    ];
  }

  if (!context.lhs && src[index].src === 'fn') {
    index++;

    const node = (pattern: Tree, expr?: Tree) => {
      if (!expr) {
        return _node(NodeType.FUNCTION, {
          position: nodePosition(),
          children: [pattern],
          data: { isTopFunction: true },
        });
      }

      const node = _node(NodeType.FUNCTION, {
        position: nodePosition(),
        children: [pattern, expr],
        data: { isTopFunction: true },
      });
      inject(Injectable.ASTNodePrecedenceMap).set(node.id, [null, null]);
      return node;
    };

    return parseStatementForm(context, parsePattern, node)(src, index);
  }

  if (!context.lhs && src[index].src === 'if') {
    index++;
    const __node = (condition: Tree, trueBranch?: Tree) => {
      return _node('', {
        children: [condition, ...(trueBranch ? [trueBranch] : [])],
      });
    };

    let result: Tree;
    [index, result] = parseStatementForm(
      context,
      parseExpr,
      __node
    )(src, index);

    const condition = result.children[0];
    const trueBranch = result.children[1];
    if (!trueBranch) {
      let body: Tree;
      let _index = index;
      [index, body] = parseExpr({
        ...context,
        banned: ['else'],
      })(src, index);

      if (src[index]?.src !== 'else') {
        return [
          _index,
          _node(NodeType.IF, {
            position: nodePosition(),
            children: [condition],
          }),
        ];
      }

      index++;
      return [
        index,
        _node(NodeType.IF_ELSE, {
          position: nodePosition(),
          children: [condition, body],
        }),
      ];
    }

    if (src[index]?.src === 'else') {
      index++;
      return [
        index,
        _node(NodeType.IF_ELSE, {
          position: nodePosition(),
          children: [condition, trueBranch],
        }),
      ];
    }

    if (src[index]?.type === 'newline' && src[index + 1]?.src === 'else') {
      index += 2;
      return [
        index,
        _node(NodeType.IF_ELSE, {
          position: nodePosition(),
          children: [condition, trueBranch],
        }),
      ];
    }

    const node = _node(NodeType.IF, {
      position: nodePosition(),
      children: [condition, trueBranch],
    });
    inject(Injectable.ASTNodePrecedenceMap).set(node.id, [null, null]);
    return [index, node];
  }

  if (!context.lhs && src[index].src === 'while') {
    index++;

    const node = (condition: Tree, expr?: Tree) => {
      if (!expr) {
        return _node(NodeType.WHILE, {
          position: nodePosition(),
          children: [condition],
        });
      }

      const node = _node(NodeType.WHILE, {
        position: nodePosition(),
        children: [condition, expr],
      });
      inject(Injectable.ASTNodePrecedenceMap).set(node.id, [null, null]);
      return node;
    };

    return parseStatementForm(context, parseExpr, node)(src, index);
  }

  if (!context.lhs && src[index].src === 'for') {
    index++;
    let pattern: Tree;
    [index, pattern] = parsePattern({
      ...context,
      banned: ['in'],
    })(src, index);

    if (src[index]?.src !== 'in') {
      return [
        index,
        error(
          SystemError.missingToken(nodePosition(), 'in'),
          _node(NodeType.FOR, {
            position: nodePosition(),
            children: [pattern],
          })
        ),
      ];
    }

    index++;
    const node = (expr: Tree, body?: Tree) => {
      if (!body) {
        let node: Tree = _node(NodeType.FOR, {
          position: nodePosition(),
          children: [pattern, expr],
        });
        return node;
      }

      let node: Tree = _node(NodeType.FOR, {
        position: nodePosition(),
        children: [pattern, expr, body],
      });
      inject(Injectable.ASTNodePrecedenceMap).set(node.id, [null, null]);

      return node;
    };

    return parseStatementForm(context, parseExpr, node)(src, index);
  }

  if (!context.lhs && src[index].src === 'switch') {
    index++;
    let value: Tree;
    [index, value] = parseExpr({
      ...context,

      banned: ['{'],
    })(src, index);
    const cases: Tree[] = [];
    const node = () =>
      _node(NodeType.MATCH, {
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

    context.followSet.push('}');
    while (src[index] && src[index].src !== '}') {
      if (src[index]?.type === 'newline') {
        index++;
        continue;
      }
      let pattern: Tree;
      [index, pattern] = parsePattern({ ...context, banned: ['->'] })(
        src,
        index
      );
      if (src[index]?.src === '->') index++;
      // else error missing ->
      let body: Tree;
      [index, body] = parseExpr({ ...context, banned: ['}', ','] })(src, index);
      if (src[index]?.src === ',') index++;

      const node = _node(NodeType.MATCH_CASE, { children: [pattern, body] });
      cases.push(node);
    }
    context.followSet.pop();

    if (src[index]?.src !== '}') {
      return [
        index,
        error(SystemError.missingToken(nodePosition(), '}'), node()),
      ];
    }

    index++;
    return [index, node()];
  }

  if (!context.lhs && src[index].src === 'inject') {
    index++;

    const node = (value: Tree, expr?: Tree) => {
      if (!expr) {
        return _node(NodeType.INJECT, {
          position: nodePosition(),
          children: [value],
        });
      }

      const node = _node(NodeType.INJECT, {
        position: nodePosition(),
        children: [value, expr],
      });
      inject(Injectable.ASTNodePrecedenceMap).set(node.id, [null, null]);
      return node;
    };

    return parseStatementForm(context, parseExpr, node)(src, index);
  }

  if (!context.lhs && src[index].src === 'without') {
    index++;

    const node = (value: Tree, expr?: Tree) => {
      if (!expr) {
        return _node(NodeType.WITHOUT, {
          position: nodePosition(),
          children: [value],
        });
      }

      const node = _node(NodeType.WITHOUT, {
        position: nodePosition(),
        children: [value, expr],
      });
      inject(Injectable.ASTNodePrecedenceMap).set(node.id, [null, null]);
      return node;
    };

    return parseStatementForm(context, parseExpr, node)(src, index);
  }

  if (!context.lhs && src[index].src === 'mask') {
    index++;

    const node = (value: Tree, expr?: Tree) => {
      if (!expr) {
        return _node(NodeType.MASK, {
          position: nodePosition(),
          children: [value],
        });
      }

      const node = _node(NodeType.MASK, {
        position: nodePosition(),
        children: [value, expr],
      });
      inject(Injectable.ASTNodePrecedenceMap).set(node.id, [null, null]);
      return node;
    };

    return parseStatementForm(context, parseExpr, node)(src, index);
  }

  if (!context.lhs) {
    const [nextIndex, pattern] = parsePattern(context)(src, index);
    if (
      src[nextIndex] &&
      !tokenIncludes(src[nextIndex], context.followSet) &&
      !tokenIncludes(src[nextIndex], context.banned) &&
      pattern.type !== NodeType.ERROR &&
      Object.hasOwn(idToLhsPatternExprOp, src[nextIndex].src)
    ) {
      const op = idToLhsPatternExprOp[src[nextIndex].src];
      return [
        nextIndex + 1,
        _node(op, { position: nodePosition(), children: [pattern] }),
      ];
    }
  }

  if (!context.lhs && Object.hasOwn(idToPrefixExprOp, src[index].src)) {
    const op = idToPrefixExprOp[src[index].src];
    index++;
    return [index, _node(op, { position: nodePosition() })];
  }

  if (context.lhs && Object.hasOwn(idToExprOp, src[index].src)) {
    const op = idToExprOp[src[index].src];
    index++;
    return [index, _node(op)];
  }

  if (context.lhs && src[index].type === 'newline') {
    index++;

    if (!src[index]) return [index, _node(NodeType.SEQUENCE)];

    if (context.lhs && Object.hasOwn(idToExprOp, src[index].src)) {
      const op = idToExprOp[src[index].src];
      index++;
      return [index, _node(op)];
    }

    if (context.lhs && src[index].src === '.') {
      index++;
      const next = src[index];
      if (
        !tokenIncludes(next, context.followSet) &&
        next?.type === 'identifier'
      ) {
        index++;
        const key = string(next.src, { start: next.start, end: next.end });
        return [
          index,
          _node(NodeType.INDEX, {
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

    return [index, _node(NodeType.SEQUENCE)];
  }

  if (!context.lhs && src[index].src === '|') {
    index++;
    return parsePrattGroup(
      context,
      parseExprGroup,
      getExprPrecedence
    )(src, index);
  }

  if (!context.lhs && src[index].src === '{') {
    const node = (expr: Tree) => block(expr, nodePosition());

    return parsePairGroup(context, ['{', '}'], parseExpr, node)(src, index);
  }

  if (src[index].src === '[') {
    const node = (expr: Tree) =>
      _node(context.lhs ? NodeType.INDEX : NodeType.SQUARE_BRACKETS, {
        position: nodePosition(),
        children: [expr],
      });

    return parsePairGroup(
      { ...context },
      ['[', ']'],
      parseExpr,
      node
    )(src, index);
  }

  if (!context.lhs && src[index].src === '(') {
    const node = (expr: Tree) =>
      _node(NodeType.PARENS, { position: nodePosition(), children: [expr] });
    return parsePairGroup(
      { ...context },
      ['(', ')'],
      parseExpr,
      node
    )(src, index);
  }

  if (context.lhs && src[index].src === '.') {
    index++;
    const next = src[index];
    if (
      !tokenIncludes(next, context.followSet) &&
      next?.type === 'identifier'
    ) {
      index++;
      const key = string(next.src, { start: next.start, end: next.end });
      return [
        index,
        _node(NodeType.INDEX, {
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

  if (context.lhs) {
    const node = _node(NodeType.APPLICATION);

    // if function call is with parentheses, make precedence higher than field access
    // so method chaining works as usual
    if (src[index].src === '(') {
      const indexPrecedence = _getExprPrecedence(NodeType.INDEX);
      const applicationPrecedence = _getExprPrecedence(NodeType.APPLICATION);
      inject(Injectable.ASTNodePrecedenceMap).set(node.id, [
        applicationPrecedence[0],
        indexPrecedence[0]! + 1,
      ]);
    }

    return [index, node];
  }

  return parseValue(src, i);
};

const parsePrattGroup =
  (
    context: Context,
    groupParser: (
      context: Context
    ) => (tokens: TokenPos[], index: number) => [index: number, node: Tree],
    getPrecedence: (node: Tree) => Precedence
  ): Parser =>
  (src, i) => {
    let index = i;
    const start = index;
    const nodePosition = () => mapListPosToPos(position(start, index), src);

    if (!src[index]) {
      return [
        index,
        error(SystemError.endOfSource(nodePosition()), nodePosition()),
      ];
    }

    // if (!context.followSet.includes(')') && src[index].src === ')') {
    //   while (src[index] && src[index].src === ')') index++;
    //   return [
    //     index,
    //     error(
    //       SystemError.unbalancedCloseToken(['(', ')'], nodePosition()),
    //       nodePosition()
    //     ),
    //   ];
    // }
    // if (!context.followSet.includes('}') && src[index].src === '}') {
    //   while (src[index] && src[index].src === '}') index++;
    //   return [
    //     index,
    //     error(
    //       SystemError.unbalancedCloseToken(['{', '}'], nodePosition()),
    //       nodePosition()
    //     ),
    //   ];
    // }
    // if (!context.followSet.includes(']') && src[index].src === ']') {
    //   while (src[index] && src[index].src === ']') index++;
    //   return [
    //     index,
    //     error(
    //       SystemError.unbalancedCloseToken(['[', ']'], nodePosition()),
    //       nodePosition()
    //     ),
    //   ];
    // }

    if (tokenIncludes(src[index], context.skip))
      return parsePrattGroup(
        context,
        groupParser,
        getPrecedence
      )(src, index + 1);
    if (tokenIncludes(src[index], context.banned))
      return [index, implicitPlaceholder(nodePosition())];
    if (tokenIncludes(src[index], context.followSet))
      return [index, implicitPlaceholder(nodePosition())];

    let node: Tree;
    [index, node] = groupParser(context)(src, index);

    while (tokenIncludes(src[index], context.skip)) index++;

    return [index, node];
  };

const parsePrefix =
  (
    context: Context,
    groupParser: (
      context: Context
    ) => (tokens: TokenPos[], index: number) => [index: number, node: Tree],
    getPrecedence: (node: Tree) => Precedence
  ): Parser =>
  (src, i) => {
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

    let [nextIndex, group] = parsePrattGroup(
      { ...context, lhs: false },
      groupParser,
      getPrecedence
    )(src, index);
    index = nextIndex;
    const [, right] = getPrecedence(group);

    if (right !== null) {
      let rhs: Tree;
      [index, rhs] = parsePratt(
        context,
        groupParser,
        getPrecedence,
        right
      )(src, index);
      return [index, prefix(group, rhs)];
    }

    return [index, group];
  };

const parsePratt =
  (
    context: Context,
    groupParser: (
      context: Context
    ) => (tokens: TokenPos[], index: number) => [index: number, node: Tree],
    getPrecedence: (node: Tree) => Precedence,
    precedence: number
  ): Parser =>
  (src, i) => {
    let index = i;
    let lhs: Tree;
    [index, lhs] = parsePrefix(context, groupParser, getPrecedence)(src, index);
    const until = () => {
      return (
        context.followSet.length === 0 ||
        !tokenIncludes(src[index], context.followSet) ||
        context.banned.length === 0 ||
        !tokenIncludes(src[index], context.banned)
      );
    };

    while (src[index] && until()) {
      let [nextIndex, opGroup] = parsePrattGroup(
        { ...context, lhs: true },
        groupParser,
        getPrecedence
      )(src, index);
      const [left, right] = getPrecedence(opGroup);
      if (left === null) break;
      if (left <= precedence) break;
      index = nextIndex;

      if (right === null) {
        lhs = postfix(opGroup, lhs);
        continue;
      }

      if (opGroup.type === NodeType.SEQUENCE) {
        if (src[index]?.type === 'newline') index++;
        if (!src[index]) break;
      }

      let rhs: Tree;
      [index, rhs] = parsePratt(
        context,
        groupParser,
        getPrecedence,
        right
      )(src, index);

      // if two same operators are next to each other, and their precedence is the same on both sides
      // so it is both left and right associative
      // which means we can put all arguments into one group
      const associative = left === right;
      const hasSameOperator = opGroup.type === lhs.type;
      const isPlaceholder = rhs.type === NodeType.IMPLICIT_PLACEHOLDER;

      if (associative && hasSameOperator && !isPlaceholder) {
        lhs.children.push(rhs);
      } else if (!isPlaceholder) {
        lhs = infix(opGroup, lhs, rhs);
      } else if (!(associative && hasSameOperator)) {
        lhs = postfix(opGroup, lhs);
      }
    }

    if (lhs.type === NodeType.SEQUENCE && lhs.children.length === 1) {
      return [index, lhs.children[0]];
    }

    return [index, lhs];
  };

const parseExpr =
  (context: Context): Parser<ExpressionNode> =>
  (src, i) => {
    return parsePratt(
      { ...context, allowPatternDefault: false },
      parseExprGroup,
      getExprPrecedence,
      0
    )(src, i) as unknown as [index: number, ast: ExpressionNode];
  };

const parsePattern =
  (context: Context): Parser =>
  (src, i) => {
    return parsePratt(
      context,
      parsePatternGroup,
      getPatternPrecedence,
      0
    )(src, i) as unknown as [index: number, ast: Tree];
  };

export const parseScript = (src: TokenPos[]) => {
  const context = newContext();
  const [_, expr] = parseExpr(context)(src, 0);
  return script(expr);
};

type DeclarationNode = ImportNode | DeclarationPatternNode | ExportNode;
const parseDeclaration: Parser<DeclarationNode> = (src, i) => {
  const context = newContext();
  context.banned = [';'];
  return parseExpr(context)(src, i) as unknown as [
    index: number,
    ast: ImportNode | DeclarationPatternNode | ExportNode
  ];
};

export const parseModule = (src: TokenPos[]) => {
  const children: (ImportNode | DeclarationPatternNode | ErrorNode)[] = [];
  let lastExport: ExportNode | null = null;
  let index = 0;

  while (src[index]) {
    if (tokenIncludes(src[index], ['\n', ';'])) {
      index++;
      continue;
    }
    let node: ImportNode | DeclarationPatternNode | ExportNode;
    [index, node] = parseDeclaration(src, index);
    if (node.type === NodeType.EXPORT) {
      if (node.children[0].type === NodeType.DECLARE) {
        children.push(node as unknown as DeclarationPatternNode);
        continue;
      }
      if (lastExport) {
        const errorNode = error(
          SystemError.duplicateDefaultExport(getPosition(lastExport)),
          lastExport
        );
        children.push(errorNode);
      }
      lastExport = node;
    } else children.push(node);
  }

  if (lastExport) children.push(lastExport as any);
  return module(
    children.flatMap((node) =>
      (node as Tree).type === 'sequence' ? node.children : [node]
    ) as any
  );
};

if (import.meta.vitest) {
  const { expect } = import.meta.vitest;
  const { it, fc } = await import('@fast-check/vitest');
  const { tokenArbitrary, tokenListArbitrary } = await import(
    '../src/testing.js'
  );
  const zeroPos = { start: 0, end: 0 };
  const arb1 = fc.oneof(
    fc.constant(['(', ')']),
    fc.constant(['[', ']']),
    fc.constant(['{', '}'])
  );

  it.prop([fc.array(tokenArbitrary)])(
    'module parsing never throws',
    (tokens) => {
      try {
        parseModule(tokens.map((t) => ({ ...t, ...zeroPos })));
      } catch (e) {
        const msg = e instanceof Error ? e.stack : e;
        expect.unreachable(msg as string);
      }
    }
  );

  it.prop([fc.array(tokenArbitrary)])(
    'script parsing never throws',
    (tokens) => {
      try {
        parseScript(tokens.map((t) => ({ ...t, ...zeroPos })));
      } catch (e) {
        const msg = e instanceof Error ? e.stack : e;
        expect.unreachable(msg as string);
      }
    }
  );

  it.prop([fc.array(tokenArbitrary)])(
    'module is always flat sequence',
    (tokens) => {
      tokens = tokens.map((t) => ({ ...t, ...zeroPos }));
      let ast = parseModule(tokens as TokenPos[]);
      expect(
        ast.children.every((node) => (node as Tree).type !== 'sequence')
      ).toBe(true);
    }
  );

  it.prop([fc.array(tokenArbitrary)])(
    'script is always flat sequence',
    (tokens) => {
      tokens = tokens.map((t) => ({ ...t, ...zeroPos }));
      let ast = parseScript(tokens as TokenPos[]);
      expect(
        ast.children.every((node) => (node as Tree).type !== 'sequence')
      ).toBe(true);
    }
  );

  const arb2 = arb1.chain(([open, close]) =>
    tokenListArbitrary
      .filter(
        (tokens) => !tokens.some((t) => t.src !== open && t.src !== close)
      )
      .map((tokens) => [
        { type: 'identifier', src: open },
        ...tokens,
        { type: 'identifier', src: close },
      ])
  );

  it.prop([arb2])('pattern parsing always bound by paired tokens', (tokens) => {
    const patternType =
      tokens[0].src === '['
        ? NodeType.SQUARE_BRACKETS
        : tokens[0].src === '{'
        ? NodeType.RECORD
        : NodeType.PARENS;

    tokens = tokens.map((t) => ({ ...t, ...zeroPos }));
    let ast = parsePattern(newContext())(tokens as TokenPos[], 0)[1];
    expect(ast).toMatchObject({ type: patternType });
  });

  it.prop([arb2])('expr parsing always bound by paired tokens', (tokens) => {
    const exprType =
      tokens[0].src === '('
        ? NodeType.PARENS
        : tokens[0].src === '{'
        ? NodeType.BLOCK
        : NodeType.SQUARE_BRACKETS;

    tokens = tokens.map((t) => ({ ...t, ...zeroPos }));

    let ast = parseExpr(newContext())(tokens as TokenPos[], 0)[1];
    expect(ast).toMatchObject({ type: exprType });
  });
}
