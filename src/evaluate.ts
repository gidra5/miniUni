import { rejects } from 'assert';
import { SystemError } from './error.js';
import { addFile, getModule, Prelude } from './files.js';
import {
  OperatorType,
  parseScript,
  type AbstractSyntaxTree,
} from './parser.js';
import { parseTokens } from './tokens.js';
import { assert, getClosestName, inspect, unreachable } from './utils.js';
import { EvalFunction, EvalValue } from './values.js';

// type Continuation = (arg: EvalValue) => Promise<EvalValue>;
type Channel = {
  queue: (EvalValue | Error)[];
  onReceive: Array<{
    resolve: (v: EvalValue) => void;
    reject: (e: unknown) => void;
  }>;
};
export type Context = {
  env: Record<string, EvalValue>;
};

export function isChannel(
  channelValue: EvalValue
): channelValue is { channel: symbol } {
  return (
    !!channelValue &&
    typeof channelValue === 'object' &&
    'channel' in channelValue
  );
}

const channels: Record<symbol, Channel> = {};

export const createChannel = () => {
  const channel = Symbol();
  channels[channel] = {
    queue: [],
    onReceive: [],
  };
  return { channel };
};

export const getChannel = (c: EvalValue) => {
  assert(isChannel(c), 'not a channel');
  assert(c.channel in channels, 'channel not found');
  const channel = channels[c.channel];
  return channel;
};

export const send = (_channel: EvalValue, value: EvalValue | Error) => {
  const channel = getChannel(_channel);
  const promise = channel.onReceive.shift();
  if (promise) {
    const { resolve, reject } = promise;
    if (value instanceof Error) reject(value);
    else resolve(value);

    channel.onReceive = channel.onReceive.filter(
      (_promise) => _promise !== promise
    );
  } else channel.queue.push(value);
};

export const receive = (_channel: EvalValue) => {
  const channel = getChannel(_channel);

  if (channel.queue.length > 0) {
    const next = channel.queue.shift()!;
    if (next instanceof Error) throw next;
    return next;
  }

  return new Promise<EvalValue>((resolve, reject) => {
    const promise = {
      resolve: (v: EvalValue) => {
        resolve(v);
        channel.onReceive = channel.onReceive.filter(
          (_promise) => _promise !== promise
        );
      },

      reject: (e: unknown) => {
        reject(e);
        channel.onReceive = channel.onReceive.filter(
          (_promise) => _promise !== promise
        );
      },
    };

    channel.onReceive.push(promise);
  });
};

export const newContext = (): Context => {
  return { env: {} };
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
    assert(
      Array.isArray(value),
      SystemError.invalidTuplePattern(patternAst.data.position)
    );

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

  if (patternAst.data.operator === OperatorType.PARENS) {
    return await assign(patternAst.children[0], value, context);
  }

  if (patternAst.data.operator === OperatorType.INDEX) {
    const [list, index] = await Promise.all(
      patternAst.children.map((child) => evaluateExpr(child, context))
    );
    assert(
      Array.isArray(list),
      SystemError.invalidIndexTarget().withNode(patternAst)
    );
    assert(
      Number.isInteger(index),
      SystemError.invalidIndex().withNode(patternAst)
    );
    assert(typeof index === 'number');
    list[index] = value;
    return context;
  }

  if (patternAst.name === 'name') {
    const env = { ...context.env };
    const name = patternAst.data.value;
    assert(
      name in env,
      SystemError.invalidAssignment(
        name,
        patternAst.data.position,
        getClosestName(name, Object.keys(env))
      )
    );
    env[name] = value;
    context.env = env;
    return context;
  }

  unreachable(SystemError.invalidPattern(patternAst.data.position));
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
    assert(
      Array.isArray(value),
      SystemError.invalidTuplePattern(patternAst.data.position)
    );

    const patterns = patternAst.children;
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];

      if (pattern.data.operator === OperatorType.SPREAD) {
        const rest = value.slice(i);
        context = await bind(pattern.children[0], rest, context);
      } else {
        const v = value[i];
        context = await bind(pattern, v, context);
      }
    }

    return context;
  }

  if (patternAst.data.operator === OperatorType.PARENS) {
    return await bind(patternAst.children[0], value, context);
  }

  if (patternAst.name === 'name') {
    const env = { ...context.env };
    const name = patternAst.data.value;
    env[name] = value;
    context.env = env;
    return context;
  }

  unreachable(SystemError.invalidPattern(patternAst.data.position));
};

export const evaluateExpr = async (
  ast: AbstractSyntaxTree,
  context: Context = newContext()
): Promise<EvalValue> => {
  switch (ast.name) {
    case 'operator': {
      switch (ast.data.operator) {
        case OperatorType.IMPORT: {
          const name = ast.children[0].data.value;
          const module = getModule(name);
          context.env = { ...module, ...context.env };
          return module;
        }

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
          if (ast.children[0].name === 'implicit_placeholder') return [];
          return await evaluateExpr(ast.children[0], context);

        case OperatorType.INDEX: {
          const [list, index] = await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          );

          assert(
            Array.isArray(list),
            SystemError.invalidIndexTarget().withNode(ast)
          );
          assert(
            Number.isInteger(index),
            SystemError.invalidIndex().withNode(ast)
          );
          assert(typeof index === 'number');
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
          unreachable(SystemError.invalidUseOfSpread().withNode(ast));

        case OperatorType.PARALLEL: {
          const _channels = ast.children.map((child) => {
            const channel = createChannel();
            evaluateExpr(child, { ...context }).then(
              (value) => send(channel, value),
              (e) => send(channel, e)
            );

            return channel;
          });
          return _channels;
        }

        case OperatorType.SEND: {
          const [channelValue, value] = await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          );
          const channel = getChannel(channelValue);

          assert(channel, SystemError.invalidSendChannel().withNode(ast));

          const promise = channel.onReceive.shift();
          if (promise) {
            const { resolve, reject } = promise;
            if (value instanceof Error) reject(value);
            else resolve(value);

            channel.onReceive = channel.onReceive.filter(
              (_promise) => _promise !== promise
            );
          } else channel.queue.push(value);
        }
        case OperatorType.RECEIVE: {
          const channelValue = await evaluateExpr(ast.children[0], context);
          const channel = getChannel(channelValue);

          assert(channel, SystemError.invalidReceiveChannel().withNode(ast));

          if (channel.queue.length > 0) {
            const next = channel.queue.shift()!;
            if (next instanceof Error) throw next;
            return next;
          }

          return new Promise<EvalValue>((resolve, reject) => {
            const promise = {
              resolve: (v: EvalValue) => {
                resolve(v);
                channel.onReceive = channel.onReceive.filter(
                  (_promise) => _promise !== promise
                );
              },

              reject: (e: unknown) => {
                reject(e);
                channel.onReceive = channel.onReceive.filter(
                  (_promise) => _promise !== promise
                );
              },
            };

            channel.onReceive.push(promise);
          });
        }

        case OperatorType.TOKEN:
          unreachable(SystemError.invalidTokenExpression().withNode(ast));

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
          await assign(pattern, value, context);
          return value;
        }
        case OperatorType.DECLARE: {
          const [pattern, expr] = ast.children;
          const value = await evaluateExpr(expr, context);
          await bind(pattern, value, context);
          return value;
        }
        case OperatorType.SEQUENCE:
          return await evaluateSequence(ast, context);
        case OperatorType.BLOCK:
          return await evaluateExpr(ast.children[0], { ...context });

        case OperatorType.FUNCTION: {
          const [patterns, body] = ast.children;

          if (patterns.data.operator !== OperatorType.TUPLE) {
            return async (arg) => {
              const bound = await bind(patterns, arg, { ...context });
              try {
                return await evaluateExpr(body, bound);
              } catch (e) {
                if (typeof e === 'object' && e !== null && 'return' in e)
                  return e.return as EvalValue;
                else throw e;
              }
            };
          }

          const binder = (...args: EvalValue[]): EvalFunction => {
            const _context = { ...context, env: { ...context.env } };
            return async (arg) => {
              if (args.length < patterns.children.length - 1) {
                return binder(...args, arg);
              }
              args.push(arg);
              const bound = await bind(patterns, args, _context);
              bound.env['self'] = binder();

              try {
                const x = await evaluateExpr(body, bound);
                return x;
              } catch (e) {
                if (typeof e === 'object' && e !== null && 'return' in e) {
                  return e.return as EvalValue;
                } else throw e;
              }
            };
          };
          return binder();
        }
        case OperatorType.APPLICATION: {
          const [fnValue, argValue] = await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          );

          assert(
            typeof fnValue === 'function',
            SystemError.invalidApplicationExpression(ast.data.position)
          );

          return await fnValue(argValue);
        }
      }
    }

    case 'name':
      const name = ast.data.value;
      if (name === 'true') return true;
      if (name === 'false') return false;
      assert(
        name in context.env,
        SystemError.undeclaredName(name, ast.data.position)
      );
      return context.env[name];
    case 'number':
    case 'string':
      return ast.data.value;
    case 'placeholder':
    case 'implicitPlaceholder':
      unreachable(SystemError.invalidPlaceholderExpression().withNode(ast));
    case 'error':
      unreachable(ast.data.cause);
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
  const preludeModule = getModule(Prelude);
  context.env = { ...preludeModule, ...context.env };
  return await evaluateSequence(ast, context);
};

export const evaluateScriptString = async (
  input: string,
  context: Context = newContext()
): Promise<EvalValue> => {
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);
  try {
    return await evaluateScript(ast, context);
  } catch (e) {
    if (e instanceof SystemError) {
      const fileId = addFile('repl', input);
      e.withFileId(fileId).print();
    } else console.error(e);
    return null;
  }
};
