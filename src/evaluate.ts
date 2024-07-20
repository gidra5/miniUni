import { OperatorType, parseScript, type AbstractSyntaxTree } from './parser';
import { parseTokens } from './tokens';
import { assert } from './utils';

// type Continuation = (arg: EvalValue) => Promise<EvalValue>;
type EvalFunction = (arg: EvalValue) => Promise<EvalValue>;
type EvalValue =
  | number
  | string
  | boolean
  | null
  | EvalValue[]
  | EvalFunction
  | { channel: symbol };
type Channel = {
  queue: EvalValue[];
  onReceive: Array<(v: EvalValue) => void>;
};
type Context = {
  env: Record<string, EvalValue>;
  channels: Record<symbol, Channel>;
};

// export const fn =
//   (_fn: (arg: EvalValue) => Promise<EvalValue>): EvalFunction =>
//   async (arg, cont) =>
//     cont(await _fn(arg));

export const newContext = (): Context => {
  const channels = {};
  return {
    env: {
      channel: async () => {
        const channel = Symbol();
        return { channel };
      },
      floor: async (n) => {
        assert(typeof n === 'number', 'floor on non-number');
        return Math.floor(n);
      },
      length: async (list) => {
        assert(Array.isArray(list), 'length on non-list');
        return list.length;
      },
      number: async (n) => {
        return Number(n);
      },
    },
    channels,
  };
};

export const assign = async (
  patternAst: AbstractSyntaxTree,
  value: EvalValue,
  context: Context
): Promise<Context> => {
  if (
    patternAst.name === 'placeholder' ||
    patternAst.name === 'implicitPlaceholder'
  ) {
    return context;
  }

  if (patternAst.data.operator === OperatorType.TUPLE) {
    assert(Array.isArray(value), 'tuple pattern on non-tuple');

    const patterns = patternAst.children;
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];

      if (pattern.data.operator === OperatorType.SPREAD) {
        const rest = value.slice(i);
        context = await assign(pattern.children[0], rest, context);
      } else {
        const v = value[i];
        context = await assign(pattern, v, context);
      }
    }

    return context;
  }

  if (patternAst.name === 'identifier') {
    const env = { ...context.env };
    const name = patternAst.data.value;
    if (!(name in env)) {
      assert(
        false,
        `can't assign to undeclared variable: ${patternAst.data.value}`
      );
    }
    env[name] = value;
    context.env = env;
    return context;
  }

  assert(false, 'invalid assignment pattern');
};

export const bind = async (
  patternAst: AbstractSyntaxTree,
  value: EvalValue,
  context: Context
): Promise<Context> => {
  if (
    patternAst.name === 'placeholder' ||
    patternAst.name === 'implicitPlaceholder'
  ) {
    return context;
  }

  if (patternAst.data.operator === OperatorType.TUPLE) {
    assert(Array.isArray(value), 'tuple pattern on non-tuple');

    const patterns = patternAst.children;
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];

      if (pattern.data.operator === OperatorType.SPREAD) {
        const rest = value.slice(i);
        context = await assign(pattern.children[0], rest, context);
      } else {
        const v = value[i];
        context = await assign(pattern, v, context);
      }
    }

    return context;
  }

  if (patternAst.name === 'identifier') {
    const env = { ...context.env };
    const name = patternAst.data.value;
    if (!(name in env)) {
      assert(
        false,
        `can't assign to undeclared variable: ${patternAst.data.value}`
      );
    }
    env[name] = value;
    context.env = env;
    return context;
  }

  assert(false, 'invalid declaration pattern');
};

export const evaluateExpr = async (
  ast: AbstractSyntaxTree,
  context: Context = newContext()
): Promise<EvalValue> => {
  switch (ast.name) {
    case 'operator': {
      switch (ast.data.operator) {
        case OperatorType.ADD: {
          const args = (await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          )) as number[];
          return args.reduce((acc, arg) => acc + arg);
        }
        case OperatorType.SUB: {
          const [left, right] = (await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          )) as number[];
          return left - right;
        }
        case OperatorType.MULT: {
          const args = (await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          )) as number[];
          return args.reduce((acc, arg) => acc * arg);
        }
        case OperatorType.DIV: {
          const [left, right] = (await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          )) as number[];
          return left / right;
        }
        case OperatorType.MOD: {
          const [left, right] = (await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          )) as number[];
          return left % right;
        }
        case OperatorType.POW: {
          const [left, right] = (await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          )) as number[];
          return left ** right;
        }
        case OperatorType.MINUS: {
          const arg = evaluateExpr(ast.children[0], context);
          return -arg;
        }
        case OperatorType.PLUS: {
          const arg = evaluateExpr(ast.children[0], context);
          return +arg;
        }

        case OperatorType.AND: {
          const [head, ...rest] = ast.children;
          const result = await evaluateExpr(head, context);
          if (!result) return false;
          while (rest.length > 0) {
            const next = rest.shift();
            assert(next, 'missing expression in and operator');
            const result = await evaluateExpr(next, context);
            if (!result) return false;
          }
          return true;
        }
        case OperatorType.OR: {
          const [head, ...rest] = ast.children;
          const result = await evaluateExpr(head, context);
          if (result) return true;
          while (rest.length > 0) {
            const next = rest.shift();
            assert(next, 'missing expression in or operator');
            const result = await evaluateExpr(next, context);
            if (result) return true;
          }
          return false;
        }
        case OperatorType.EQUAL: {
          const [left, right] = await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          );
          return left === right;
        }
        case OperatorType.NOT_EQUAL: {
          const [left, right] = await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          );
          return left !== right;
        }
        case OperatorType.LESS: {
          const [left, right] = (await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          )) as number[];
          return left < right;
        }
        case OperatorType.LESS_EQUAL: {
          const [left, right] = (await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          )) as number[];
          return left <= right;
        }
        case OperatorType.NOT: {
          const arg = await evaluateExpr(ast.children[0], context);
          return !arg;
        }
        case OperatorType.PARENS:
          if (ast.children[0].name === 'implicitPlaceholder') return [];
          return await evaluateExpr(ast.children[0], context);

        case OperatorType.INDEX: {
          const [list, index] = await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          );
          assert(Array.isArray(list), 'indexing on non-list');
          assert(
            typeof index === 'number' && Number.isInteger(index),
            'index is not an integer'
          );
          return list[index];
        }
        case OperatorType.TUPLE: {
          const list = await Promise.all(
            ast.children.map(async (child) => {
              if (child.data.operator === OperatorType.SPREAD)
                return await evaluateExpr(child.children[0], context);
              return [await evaluateExpr(child, context)];
            })
          );
          return list.flat();
        }
        case OperatorType.SPREAD:
          assert(
            false,
            'spread operator can only be used during tuple construction'
          );

        case OperatorType.PRINT: {
          const value = await evaluateExpr(ast.children[0], context);
          console.log(value);
          return value;
        }

        case OperatorType.PARALLEL: {
          ast.children.forEach((child) => evaluateExpr(child, { ...context }));
          return null;
        }

        case OperatorType.SEND: {
          const [channelValue, value] = await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          );
          assert(
            channelValue &&
              typeof channelValue === 'object' &&
              'channel' in channelValue,
            'send operator on non-channel'
          );
          const symbol = channelValue.channel;
          if (!(symbol in context.channels)) {
            context.channels[symbol] = {
              queue: [],
              onReceive: [],
            };
          }
          const channel = context.channels[symbol];

          const onReceive = channel.onReceive.shift();
          if (onReceive) onReceive(value);
          else channel.queue.push(value);
        }
        case OperatorType.RECEIVE: {
          const channelValue = await evaluateExpr(ast.children[0], context);
          assert(
            channelValue &&
              typeof channelValue === 'object' &&
              'channel' in channelValue,
            'receive operator on non-channel'
          );
          const symbol = channelValue.channel;
          if (!(symbol in context.channels)) {
            context.channels[symbol] = {
              queue: [],
              onReceive: [],
            };
          }
          const channel = context.channels[symbol];

          if (channel.queue.length > 0) {
            return channel.queue.shift()!;
          }

          return await new Promise((resolve) => {
            channel.onReceive.push(resolve);
          });
        }

        case OperatorType.TOKEN:
          assert(false, 'token operator should only be used during parsing');

        case OperatorType.IF: {
          const [condition, branch] = ast.children;
          const result = await evaluateExpr(condition, context);
          if (result) {
            return await evaluateExpr(branch, context);
          }
          return null;
        }
        case OperatorType.IF_ELSE: {
          const [condition, trueBranch, falseBranch] = ast.children;
          const result = await evaluateExpr(condition, context);
          if (result) return await evaluateExpr(trueBranch, context);
          else return await evaluateExpr(falseBranch, context);
        }
        case OperatorType.WHILE: {
          const [condition, body] = ast.children;
          let result: EvalValue = null;
          while (await evaluateExpr(condition, context)) {
            result = await evaluateExpr(body, context);
          }
          return result;
        }
        case OperatorType.ASSIGN: {
          const [pattern, expr] = ast.children;
          const value = await evaluateExpr(expr, context);
          assign(pattern, value, context);
          return value;
        }
        case OperatorType.DECLARE: {
          const [pattern, expr] = ast.children;
          const value = await evaluateExpr(expr, context);
          bind(pattern, value, context);
          return value;
        }
        case OperatorType.BLOCK:
          return await evaluateSequence(ast, { ...context });

        case OperatorType.FUNCTION: {
          const [patterns, body] = ast.children;
          const binder = (
            args: EvalValue[],
            context: Context
          ): EvalFunction => {
            return async (arg) => {
              args.push(arg);
              if (patterns.children.length === args.length) {
                const bound = await bind(patterns, arg, { ...context });
                return await evaluateExpr(body, bound);
              }
              return binder(args, context);
            };
          };
          return binder([], context);
        }
        case OperatorType.APPLICATION: {
          const [fnValue, argValue] = await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          );

          assert(
            typeof fnValue === 'function',
            'application on not a function'
          );

          return await fnValue(argValue);
        }
      }
    }

    case 'name':
      return context.env[ast.data.value];
    case 'number':
    case 'string':
      return ast.data.value;
    case 'placeholder':
    case 'implicitPlaceholder':
      assert(false, "placeholder can't be evaluated");
    case 'error':
      assert(false, `parsing error: ${ast.data.cause.display()}`);
    default:
      return null;
  }
};

export const evaluateSequence = async (
  ast: AbstractSyntaxTree,
  context: Context = newContext()
): Promise<EvalValue> => {
  let result: EvalValue = null;
  for (const child of ast.children) {
    result = await evaluateExpr(child, context);
  }
  return result;
};

export const evaluateScript = async (
  ast: AbstractSyntaxTree,
  context: Context = newContext()
): Promise<EvalValue> => {
  return await evaluateSequence(ast, context);
};

export const evaluateScriptString = async (
  input: string,
  context: Context = newContext()
): Promise<EvalValue> => {
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  return await evaluateScript(ast, context);
};
