import { Diagnostic, primaryDiagnosticLabel } from 'codespan-napi';
import { SystemError } from './error.js';
import {
  getModule,
  listMethods,
  ModuleDefault,
  prelude,
  stringMethods,
} from './files.js';
import { parseModule, parseScript } from './parser.js';
import {
  NodeType,
  OperatorType,
  tuple as tupleAST,
  type AbstractSyntaxTree,
} from './ast.js';
import { parseTokens } from './tokens.js';
import { assert, getClosestName, inspect, omit, unreachable } from './utils.js';
import {
  atom,
  closeChannel,
  createChannel,
  EvalFunction,
  EvalValue,
  getChannel,
  isChannel,
  isRecord,
  isSymbol,
  receive,
  send,
  tryReceive,
} from './values.js';
import { fn as fnAST } from './ast.js';
import { validate } from './validate.js';
import { inject, Injectable, register } from './injector.js';
import path from 'path';

export type Context = {
  file: string;
  fileId: number;
  env: Record<string, EvalValue>;
  handlers: Record<string | symbol, EvalValue>;
};

const forkEnv = (env: Context['env']): Context['env'] => {
  const forked: Context['env'] = {};
  Object.setPrototypeOf(forked, env);
  return forked;
};

const maskHandlers = (
  handlers: Context['handlers'],
  names: (string | symbol)[]
) => {
  const prototypes = [handlers];
  while (true) {
    const head = prototypes[prototypes.length - 1];
    const prototype = Object.getPrototypeOf(head);
    if (prototype === null) break;
    prototypes.push(prototype);
  }
  return new Proxy(handlers, {
    get(target, prop, receiver) {
      if (!names.includes(prop)) return Reflect.get(target, prop, receiver);
      const proto = prototypes.find((proto) => Object.hasOwn(proto, prop));
      if (proto) return Object.getPrototypeOf(proto)[prop];
      return Reflect.get(target, prop, receiver);
    },
  });
};

const omitHandlers = (
  handlers: Context['handlers'],
  names: (string | symbol)[]
) => {
  return new Proxy(handlers, {
    has(target, prop) {
      if (names.includes(prop)) return false;
      return Reflect.has(target, prop);
    },

    get(target, prop, receiver) {
      if (names.includes(prop)) return undefined;
      return Reflect.get(target, prop, receiver);
    },

    ownKeys(target) {
      return Reflect.ownKeys(target).filter((key) => !names.includes(key));
    },
  });
};

export const newContext = (fileId: number, file: string): Context => {
  return { file, fileId, env: forkEnv(prelude), handlers: {} };
};

const incAssign = async (
  patternAst: AbstractSyntaxTree,
  value: number | EvalValue[],
  context: Context
): Promise<Context> => {
  if (
    patternAst.type === NodeType.PLACEHOLDER ||
    patternAst.type === NodeType.IMPLICIT_PLACEHOLDER
  ) {
    return context;
  }

  if (patternAst.data.operator === OperatorType.TUPLE) {
    assert(
      Array.isArray(value),
      SystemError.invalidTuplePattern(patternAst.data.position).withFileId(
        context.fileId
      )
    );

    const patterns = patternAst.children;
    let consumed = 0;
    for (const pattern of patterns) {
      if (pattern.data.operator === OperatorType.SPREAD) {
        unreachable(
          SystemError.evaluationError(
            'you sick fuck, how would that work?',
            [],
            pattern.data.position
          ).withFileId(context.fileId)
        );
      } else {
        const v = value[consumed++];
        assert(
          typeof v === 'number' || Array.isArray(v),
          SystemError.invalidIncrementValue(pattern.data.position).withFileId(
            context.fileId
          )
        );
        context = await incAssign(pattern, v, context);
        continue;
      }
    }

    return context;
  }

  if (patternAst.data.operator === OperatorType.PARENS) {
    return await incAssign(patternAst.children[0], value, context);
  }

  assert(
    typeof value === 'number',
    SystemError.invalidIncrementValue(patternAst.data.position).withFileId(
      context.fileId
    )
  );

  if (patternAst.data.operator === OperatorType.INDEX) {
    const [list, index] = await Promise.all(
      patternAst.children.map((child) => evaluateExpr(child, context))
    );
    assert(
      Array.isArray(list),
      SystemError.invalidIndexTarget(patternAst.data.position).withFileId(
        context.fileId
      )
    );
    assert(
      Number.isInteger(index),
      SystemError.invalidIndex(patternAst.data.position).withFileId(
        context.fileId
      )
    );
    assert(typeof index === 'number');
    const v = list[index];
    assert(
      typeof v === 'number',
      SystemError.invalidIncrement(
        index.toString(),
        patternAst.data.position
      ).withFileId(context.fileId)
    );
    list[index] = value;
    return context;
  }

  if (patternAst.type === NodeType.NAME) {
    const name = patternAst.data.value;
    assert(
      name in context.env,
      SystemError.invalidAssignment(
        name,
        patternAst.data.position,
        getClosestName(name, Object.keys(context.env))
      ).withFileId(context.fileId)
    );
    const v = context.env[name];
    assert(
      typeof v === 'number',
      SystemError.invalidIncrement(name, patternAst.data.position).withFileId(
        context.fileId
      )
    );
    const enclosing = Object.getPrototypeOf(context.env);
    if (name in enclosing) {
      await incAssign(patternAst, value, { ...context, env: enclosing });
    } else context.env[name] = v + value;
    return context;
  }

  unreachable(
    SystemError.invalidPattern(patternAst.data.position).withFileId(
      context.fileId
    )
  );
};

const assign = async (
  patternAst: AbstractSyntaxTree,
  value: EvalValue,
  context: Context
): Promise<Context> => {
  if (
    patternAst.type === NodeType.PLACEHOLDER ||
    patternAst.type === NodeType.IMPLICIT_PLACEHOLDER
  ) {
    return context;
  }

  if (patternAst.data.operator === OperatorType.TUPLE) {
    assert(
      Array.isArray(value),
      SystemError.invalidTuplePattern(patternAst.data.position).withFileId(
        context.fileId
      )
    );

    const patterns = patternAst.children;
    let consumed = 0;
    for (const pattern of patterns) {
      if (pattern.data.operator === OperatorType.SPREAD) {
        const start = consumed++;
        consumed = value.length - patterns.length + consumed;
        const rest = value.slice(start, Math.max(start, consumed));
        context = await assign(pattern.children[0], rest, context);
        continue;
      } else {
        const v = value[consumed++];
        context = await assign(pattern, v, context);
        continue;
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
      SystemError.invalidIndexTarget(patternAst.data.position).withFileId(
        context.fileId
      )
    );
    assert(
      Number.isInteger(index),
      SystemError.invalidIndex(patternAst.data.position).withFileId(
        context.fileId
      )
    );
    assert(typeof index === 'number');
    assert(value !== null, 'expected value');
    list[index] = value;
    return context;
  }

  if (patternAst.type === NodeType.NAME) {
    const name = patternAst.data.value;
    assert(
      name in context.env,
      SystemError.invalidAssignment(
        name,
        patternAst.data.position,
        getClosestName(name, Object.keys(context.env))
      ).withFileId(context.fileId)
    );

    const enclosing = Object.getPrototypeOf(context.env);
    if (value === null) delete context.env[name];
    else if (name in enclosing) {
      await assign(patternAst, value, { ...context, env: enclosing });
    } else context.env[name] = value;
    return context;
  }

  unreachable(
    SystemError.invalidPattern(patternAst.data.position).withFileId(
      context.fileId
    )
  );
};

const bind = async (
  patternAst: AbstractSyntaxTree,
  value: EvalValue,
  context: Context
): Promise<Context> => {
  if (
    patternAst.type === NodeType.PLACEHOLDER ||
    patternAst.type === NodeType.IMPLICIT_PLACEHOLDER
  ) {
    return context;
  }

  if (patternAst.data.operator === OperatorType.EXPORT) {
    return await bind(patternAst.children[0], value, context);
  }

  if (patternAst.data.operator === OperatorType.TUPLE) {
    assert(
      Array.isArray(value),
      SystemError.invalidTuplePattern(patternAst.data.position).withFileId(
        context.fileId
      )
    );

    const patterns = patternAst.children;
    let consumed = 0;
    for (const pattern of patterns) {
      if (pattern.data.operator === OperatorType.SPREAD) {
        const start = consumed++;
        consumed = value.length - patterns.length + consumed;
        const rest = value.slice(start, Math.max(start, consumed));
        context = await bind(pattern.children[0], rest, context);
        continue;
      } else {
        const v = value[consumed++];
        context = await bind(pattern, v, context);
        continue;
      }
    }

    return context;
  }

  if (patternAst.data.operator === OperatorType.PARENS) {
    return await bind(patternAst.children[0], value, context);
  }

  if (patternAst.data.operator === OperatorType.OBJECT) {
    assert(value !== null, 'expected value');
    assert(
      isRecord(value),
      SystemError.invalidObjectPattern(patternAst.data.position).withFileId(
        context.fileId
      )
    );

    const record = value.record;
    const patterns = patternAst.children;
    const consumedNames: string[] = [];

    for (const pattern of patterns) {
      if (pattern.type === NodeType.NAME) {
        const name = pattern.data.value;
        context.env[name] = record[name] ?? null;
        consumedNames.push(name);
        continue;
      } else if (pattern.data.operator === OperatorType.COLON) {
        const [key, valuePattern] = pattern.children;
        const name = key.data.value;
        consumedNames.push(name);
        context = await bind(valuePattern, record[name] ?? null, context);
        continue;
      } else if (pattern.data.operator === OperatorType.SPREAD) {
        const rest = omit(record, consumedNames);
        context = await bind(pattern.children[0], { record: rest }, context);
        continue;
      }

      unreachable(
        SystemError.invalidObjectPattern(pattern.data.position).withFileId(
          context.fileId
        )
      );
    }

    return context;
  }

  if (patternAst.type === NodeType.NAME) {
    const name = patternAst.data.value;
    if (value !== null) context.env[name] = value;
    return context;
  }
  if (patternAst.data.operator === OperatorType.MUTABLE) {
    return await bind(patternAst.children[0], value, context);
  }

  unreachable(
    SystemError.invalidPattern(patternAst.data.position).withFileId(
      context.fileId
    )
  );
};

async function bindExport(
  patternAst: AbstractSyntaxTree<any>,
  value: EvalValue,
  exports: Record<string, EvalValue>,
  context: Context,
  exporting = false
): Promise<Record<string, EvalValue>> {
  if (
    patternAst.type === NodeType.PLACEHOLDER ||
    patternAst.type === NodeType.IMPLICIT_PLACEHOLDER
  ) {
    return exports;
  }

  if (patternAst.data.operator === OperatorType.EXPORT) {
    return await bindExport(
      patternAst.children[0],
      value,
      exports,
      context,
      true
    );
  }

  if (patternAst.data.operator === OperatorType.TUPLE) {
    assert(
      Array.isArray(value),
      SystemError.invalidTuplePattern(patternAst.data.position).withFileId(
        context.fileId
      )
    );

    const patterns = patternAst.children;
    let consumed = 0;
    for (const pattern of patterns) {
      if (pattern.data.operator === OperatorType.SPREAD) {
        const start = consumed++;
        consumed = value.length - patterns.length + consumed;
        const rest = value.slice(start, Math.max(start, consumed));
        exports = await bindExport(
          pattern.children[0],
          rest,
          exports,
          context,
          exporting
        );
        continue;
      } else {
        const v = value[consumed++];
        exports = await bindExport(pattern, v, exports, context, exporting);
        continue;
      }
    }

    return exports;
  }

  if (patternAst.data.operator === OperatorType.PARENS) {
    return await bindExport(
      patternAst.children[0],
      value,
      exports,
      context,
      exporting
    );
  }

  if (patternAst.data.operator === OperatorType.OBJECT) {
    assert(value !== null, 'expected value');
    assert(
      isRecord(value),
      SystemError.invalidObjectPattern(patternAst.data.position).withFileId(
        context.fileId
      )
    );
    const record = value.record;
    const patterns = patternAst.children;
    const consumedNames: string[] = [];
    for (const pattern of patterns) {
      if (pattern.type === 'name') {
        const name = pattern.data.value;
        if (exporting) exports[name] = record[name];
        consumedNames.push(name);
        continue;
      } else if (pattern.data.operator === OperatorType.COLON) {
        const [key, valuePattern] = pattern.children;
        const name = key.data.value;
        consumedNames.push(name);
        exports = await bindExport(
          valuePattern,
          record[name],
          exports,
          context,
          exporting
        );
        continue;
      } else if (pattern.data.operator === OperatorType.SPREAD) {
        const rest = omit(record, consumedNames);
        exports = await bindExport(
          pattern.children[0],
          { record: rest },
          exports,
          context,
          exporting
        );
        continue;
      }

      unreachable(
        SystemError.invalidObjectPattern(pattern.data.position).withFileId(
          context.fileId
        )
      );
    }

    return exports;
  }

  if (patternAst.type === NodeType.NAME) {
    const name = patternAst.data.value;
    if (exporting && value !== null) exports[name] = value;
    return exports;
  }

  unreachable(
    SystemError.invalidPattern(patternAst.data.position).withFileId(
      context.fileId
    )
  );
}

export const evaluateStatement = async (
  ast: AbstractSyntaxTree,
  context: Context
): Promise<EvalValue> => {
  const showNode = (msg: string = '', node = ast) => {
    const { position } = node.data;
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
  switch (ast.type) {
    case NodeType.OPERATOR: {
      switch (ast.data.operator) {
        case OperatorType.IMPORT: {
          const name = ast.data.name;
          const module = await getModule({ name, from: context.file });
          assert(
            !Buffer.isBuffer(module),
            'binary file import is not supported'
          );
          const value =
            'script' in module
              ? module.script
              : 'module' in module
              ? { record: module.module }
              : (module.buffer as unknown as EvalValue);
          const pattern = ast.children[0];
          if (pattern) {
            await bind(pattern, value, context);
          }

          return value;
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
          const arg = await evaluateExpr(ast.children[0], context);
          return -arg;
        }
        case OperatorType.PLUS: {
          const arg = await evaluateExpr(ast.children[0], context);
          return +arg;
        }
        case OperatorType.INCREMENT: {
          const arg = ast.children[0];
          assert(arg.type === NodeType.NAME, 'expected name');
          const value = await evaluateExpr(arg, context);
          assert(typeof value === 'number', 'expected number');
          await assign(arg, value + 1, context);
          return value + 1;
        }
        case OperatorType.DECREMENT: {
          const arg = ast.children[0];
          assert(arg.type === NodeType.NAME, 'expected name');
          const value = await evaluateExpr(arg, context);
          assert(typeof value === 'number', 'expected number');
          await assign(arg, value - 1, context);
          return value - 1;
        }
        case OperatorType.POST_DECREMENT: {
          const arg = ast.children[0];
          assert(arg.type === NodeType.NAME, 'expected name');
          const value = await evaluateExpr(arg, context);
          assert(typeof value === 'number', 'expected number');
          await assign(arg, value - 1, context);
          return value;
        }
        case OperatorType.POST_INCREMENT: {
          const arg = ast.children[0];
          assert(arg.type === NodeType.NAME, 'expected name');
          const value = await evaluateExpr(arg, context);
          assert(typeof value === 'number', 'expected number');
          await assign(arg, value + 1, context);
          return value;
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

          if (isSymbol(left) && isSymbol(right)) {
            return left.symbol === right.symbol;
          } else if (isChannel(left) && isChannel(right)) {
            return left.channel === right.channel;
          } else if (isRecord(left) && isRecord(right)) {
            return left.record === right.record;
          } else return left === right;
        }
        case OperatorType.NOT_EQUAL: {
          const [left, right] = await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          );

          if (isSymbol(left) && isSymbol(right)) {
            return left.symbol !== right.symbol;
          } else if (isChannel(left) && isChannel(right)) {
            return left.channel !== right.channel;
          } else if (isRecord(left) && isRecord(right)) {
            return left.record !== right.record;
          } else return left !== right;
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
        case OperatorType.GREATER: {
          const [left, right] = (await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          )) as number[];
          return left > right;
        }
        case OperatorType.GREATER_EQUAL: {
          const [left, right] = (await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          )) as number[];
          return left >= right;
        }
        case OperatorType.NOT: {
          const arg = await evaluateExpr(ast.children[0], context);
          return !arg;
        }
        case OperatorType.PARENS:
          if (ast.children[0].type === NodeType.IMPLICIT_PLACEHOLDER) return [];
          return await evaluateStatement(ast.children[0], context);

        case OperatorType.INDEX: {
          const [target, index] = await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          );

          if (Array.isArray(target)) {
            if (!Number.isInteger(index)) {
              assert(
                typeof index === 'string',
                SystemError.invalidIndex(ast.data.position).withFileId(
                  context.fileId
                )
              );
              return await listMethods[index](target, [
                ast.data.position,
                context.fileId,
              ]);
            }
            return target[index as number];
          } else if (isRecord(target)) {
            const record = target.record;
            assert(
              typeof index === 'string',
              SystemError.invalidIndex(ast.data.position).withFileId(
                context.fileId
              )
            );
            return record[index];
          }

          if (typeof target === 'string') {
            assert(
              typeof index === 'string' && index in stringMethods,
              SystemError.invalidIndex(ast.data.position).withFileId(
                context.fileId
              )
            );
            return await stringMethods[index](target, [
              ast.data.position,
              context.fileId,
            ]);
          }

          unreachable(
            SystemError.invalidIndexTarget(ast.data.position).withFileId(
              context.fileId
            )
          );
        }
        case OperatorType.TUPLE: {
          const list: EvalValue[] = [];
          const record = {};

          for (const child of ast.children) {
            if (child.data.operator === OperatorType.SPREAD) {
              const rest = await evaluateExpr(child.children[0], context);
              if (Array.isArray(rest)) list.push(...rest);
              else if (isRecord(rest)) Object.assign(record, rest.record);
              else {
                unreachable(
                  SystemError.invalidTuplePattern(
                    child.data.position
                  ).withFileId(context.fileId)
                );
              }
            } else if (child.data.operator === OperatorType.COLON) {
              const _key = child.children[0];
              const key =
                _key.type === NodeType.NAME
                  ? _key.data.value
                  : await evaluateExpr(_key, context);
              const value = await evaluateExpr(child.children[1], context);
              record[key] = value;
            } else if (child.type === NodeType.IMPLICIT_PLACEHOLDER) continue;
            else list.push(await evaluateExpr(child, context));
          }

          if (Object.keys(record).length > 0) {
            Object.assign(record, list);
            return { record };
          }

          return list;
        }
        case OperatorType.COLON: {
          const _key = ast.children[0];
          const key =
            _key.type === NodeType.NAME
              ? _key.data.value
              : await evaluateExpr(_key, context);
          const value = await evaluateExpr(ast.children[1], context);

          return { record: { [key]: value } };
        }
        case OperatorType.SPREAD:
          unreachable(
            SystemError.invalidUseOfSpread(ast.data.position).withFileId(
              context.fileId
            )
          );

        case OperatorType.ASYNC: {
          const channel = createChannel('async');
          const expr = ast.children[0];

          // any async expression should be evaluated in a new scope
          evaluateBlock(expr, context)
            .then(
              (value) => send(channel.channel, value),
              (e) => {
                send(channel.channel, e);
                console.error(e);

                if (e instanceof SystemError) e.print();
                else showNode(e.message, expr);
              }
            )
            .finally(() => {
              closeChannel(channel.channel);
            });

          return channel;
        }

        case OperatorType.PARALLEL: {
          const _channels = ast.children.map((child, i) => {
            const channel = createChannel('parallel ' + i);

            // any async expression should be evaluated in a new scope
            evaluateBlock(child, context)
              .then(
                (value) => send(channel.channel, value),
                (e) => {
                  console.error(e);
                  send(channel.channel, e);
                  if (e instanceof SystemError) e.print();
                  else showNode(e.message, child);
                }
              )
              .finally(() => {
                closeChannel(channel.channel);
              });

            return channel;
          });
          return _channels;
        }

        case OperatorType.SEND: {
          const [channelValue, value] = await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          );

          assert(
            isChannel(channelValue),
            SystemError.invalidSendChannel(ast.data.position).withFileId(
              context.fileId
            )
          );

          const channel = getChannel(channelValue.channel);

          assert(
            channel,
            SystemError.channelClosed(ast.data.position).withFileId(
              context.fileId
            )
          );

          const promise = channel.onReceive.shift();
          if (!promise) {
            channel.queue.push(value);
            return null;
          }
          const { resolve, reject } = promise;
          if (value instanceof Error) reject(value);
          else resolve(value);

          return null;
        }
        case OperatorType.RECEIVE: {
          const channelValue = await evaluateExpr(ast.children[0], context);

          assert(
            isChannel(channelValue),
            SystemError.invalidReceiveChannel(ast.data.position).withFileId(
              context.fileId
            )
          );

          return receive(channelValue.channel).catch((e) => {
            assert(
              e !== 'channel closed',
              SystemError.channelClosed(ast.data.position).withFileId(
                context.fileId
              )
            );
            throw e;
          });
        }
        case OperatorType.SEND_STATUS: {
          const [channelValue, value] = await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          );

          assert(
            isChannel(channelValue),
            SystemError.invalidSendChannel(ast.data.position).withFileId(
              context.fileId
            )
          );

          const status = send(channelValue.channel, value);
          return atom(status);
        }
        case OperatorType.RECEIVE_STATUS: {
          const channelValue = await evaluateExpr(ast.children[0], context);

          assert(
            isChannel(channelValue),
            SystemError.invalidReceiveChannel(ast.data.position).withFileId(
              context.fileId
            )
          );

          const [value, status] = tryReceive(channelValue.channel);

          if (value instanceof Error) throw value;

          return [value ?? [], atom(status)];
        }

        case OperatorType.ATOM:
          assert(ast.children[0].type === NodeType.NAME, 'expected name');
          return atom(ast.children[0].data.value);

        case OperatorType.TOKEN:
          unreachable(
            SystemError.invalidTokenExpression(ast.data.position).withFileId(
              context.fileId
            )
          );

        case OperatorType.INJECT: {
          const [expr, body] = ast.children;
          const value = await evaluateExpr(expr, context);
          assert(isRecord(value), 'expected record');

          const handlers = { ...context.handlers, ...value.record };
          Object.setPrototypeOf(handlers, context.handlers);
          return await evaluateBlock(body, { ...context, handlers });
        }
        case OperatorType.WITHOUT: {
          const [expr, body] = ast.children;
          let value = await evaluateExpr(expr, context);
          if (!Array.isArray(value)) value = [value];
          assert(
            value.every((v) => typeof v === 'string' || isSymbol(v)),
            'expected strings or symbols'
          );

          const handlerNames = value.map((v) => (isSymbol(v) ? v.symbol : v));
          const handlers = omitHandlers(context.handlers, handlerNames);
          return await evaluateBlock(body, { ...context, handlers });
        }
        case OperatorType.MASK: {
          const [expr, body] = ast.children;
          let value = await evaluateExpr(expr, context);
          if (!Array.isArray(value)) value = [value];
          assert(
            value.every((v) => typeof v === 'string' || isSymbol(v)),
            'expected strings or symbols'
          );

          const handlerNames = value.map((v) => (isSymbol(v) ? v.symbol : v));
          const handlers = maskHandlers(context.handlers, handlerNames);
          return await evaluateBlock(body, { ...context, handlers });
        }

        case OperatorType.MATCH: {
          const [expr, ...branches] = ast.children;
          const value = await evaluateExpr(expr, context);

          for (const branch of branches) {
            assert(
              branch.type === OperatorType.MATCH_CASE,
              'expected match case'
            );
            const [pattern, body] = branch.children;

            const bound = await bind(pattern, value, context).catch();
            if (bound) return await evaluateBlock(body, bound);
          }

          return null;
        }
        case OperatorType.IF: {
          const [condition, branch] = ast.children;
          const result = await evaluateExpr(condition, context);
          if (result) {
            return await evaluateBlock(branch, context);
          }
          return null;
        }
        case OperatorType.IF_ELSE: {
          const [condition, trueBranch, falseBranch] = ast.children;

          const result = await evaluateExpr(condition, context);
          if (result) return await evaluateBlock(trueBranch, context);
          else return await evaluateBlock(falseBranch, context);
        }
        case OperatorType.WHILE: {
          const [condition, body] = ast.children;
          while (true) {
            const _context = { ...context, env: forkEnv(context.env) };
            try {
              const cond = await evaluateExpr(condition, _context);
              if (!cond) return null;
              await evaluateStatement(body, _context);
            } catch (e) {
              if (typeof e === 'object' && e !== null && 'break' in e) {
                const value = e.break as EvalValue;
                return value;
              }
              if (typeof e === 'object' && e !== null && 'continue' in e) {
                const _value = e.continue as EvalValue;
                continue;
              }
              throw e;
            }
          }
        }
        case OperatorType.FOR: {
          const [pattern, expr, body] = ast.children;
          const list = await evaluateExpr(expr, context);

          assert(
            Array.isArray(list),
            SystemError.evaluationError(
              'for loop iterates over lists only.',
              [],
              expr.data.position
            )
          );

          const mapped: EvalValue[] = [];
          for (const item of list) {
            const _context = { ...context, env: forkEnv(context.env) };
            try {
              const bound = await bind(pattern, item, _context);
              const value = await evaluateStatement(body, bound);
              if (value === null) continue;
              mapped.push(value);
            } catch (e) {
              if (typeof e === 'object' && e !== null && 'break' in e) {
                const value = e.break as EvalValue;
                if (value !== null) mapped.push(value);
                break;
              }
              if (typeof e === 'object' && e !== null && 'continue' in e) {
                const value = e.continue as EvalValue;
                if (value !== null) mapped.push(value);
                continue;
              }
              throw e;
            }
          }

          return mapped;
        }
        case OperatorType.LOOP: {
          let [body] = ast.children;

          if (body.data.operator === OperatorType.BLOCK) {
            body = body.children[0];
          }

          while (true) {
            try {
              await evaluateBlock(body, context);
              continue;
            } catch (e) {
              if (typeof e === 'object' && e !== null && 'break' in e) {
                const value = e.break as EvalValue;
                return value;
              }
              if (typeof e === 'object' && e !== null && 'continue' in e) {
                const _value = e.continue as EvalValue;
                continue;
              }
              throw e;
            }
          }
        }
        case OperatorType.INC_ASSIGN: {
          const [pattern, expr] = ast.children;
          const value = await evaluateExpr(expr, context);
          assert(
            typeof value === 'number' || Array.isArray(value),
            SystemError.invalidIncrementValue(expr.data.position).withFileId(
              context.fileId
            )
          );
          await incAssign(pattern, value, context);
          return value;
        }
        case OperatorType.ASSIGN: {
          const [pattern, expr] = ast.children;
          const value = await evaluateStatement(expr, context);
          await assign(pattern, value, context);
          return value;
        }
        case OperatorType.DECLARE: {
          const [pattern, expr] = ast.children;
          const value = await evaluateStatement(expr, context);
          await bind(pattern, value, context);
          return value;
        }
        case OperatorType.SEQUENCE:
          return await evaluateSequence(ast, context);
        case OperatorType.BLOCK: {
          try {
            return await evaluateBlock(ast.children[0], context);
          } catch (e) {
            if (typeof e === 'object' && e !== null && 'break' in e)
              return e.break as EvalValue;
            else throw e;
          }
        }

        case OperatorType.FUNCTION: {
          const [_patterns, _body] = ast.children;
          const isTopFunction = ast.data.isTopFunction ?? true;
          const patterns =
            _patterns.data.operator !== OperatorType.TUPLE
              ? [_patterns]
              : _patterns.children;
          const pattern = patterns[0];
          const rest = patterns.slice(1);
          const body =
            rest.length === 0
              ? _body
              : fnAST(tupleAST(rest, _patterns.data.position), _body, {
                  isTopFunction: false,
                });

          const self: EvalFunction = async (arg, [, , callerContext]) => {
            const _context = { ...context, env: forkEnv(context.env) };
            const bound = await bind(pattern, arg, _context);
            if (isTopFunction) {
              bound.env['self'] = self;
              bound.handlers = callerContext.handlers;
            }

            try {
              return await evaluateStatement(body, bound);
            } catch (e) {
              if (typeof e === 'object' && e !== null && 'return' in e) {
                return e.return as EvalValue;
              } else throw e;
            }
          };
          return self;
        }
        case OperatorType.APPLICATION: {
          const [fnExpr, argStmt] = ast.children;
          const [fnValue, argValue] = await Promise.all([
            evaluateExpr(fnExpr, context),
            evaluateStatement(argStmt, context),
          ]);

          assert(
            typeof fnValue === 'function',
            SystemError.invalidApplicationExpression(
              fnExpr.data.position
            ).withFileId(context.fileId)
          );

          return await fnValue(argValue, [
            ast.data.position,
            context.fileId,
            context,
          ]);
        }
      }
    }

    case NodeType.NAME:
      const name = ast.data.value;
      if (name === 'true') return true;
      if (name === 'false') return false;
      if (name === 'injected') return { record: context.handlers };
      // inspect(context.env);
      assert(
        name in context.env,
        SystemError.undeclaredName(name, ast.data.position).withFileId(
          context.fileId
        )
      );
      return context.env[name];
    case NodeType.NUMBER:
    case NodeType.STRING:
      return ast.data.value;
    case NodeType.PLACEHOLDER:
      return null;
    case NodeType.IMPLICIT_PLACEHOLDER:
      unreachable(
        SystemError.invalidPlaceholderExpression(ast.data.position).withFileId(
          context.fileId
        )
      );
    case NodeType.ERROR:
      unreachable(ast.data.cause.withFileId(context.fileId));
    default:
      return null;
  }
};

export const evaluateBlock = async (
  ast: AbstractSyntaxTree,
  context: Context
): Promise<EvalValue> => {
  const _context = { ...context, env: forkEnv(context.env) };
  return await evaluateStatement(ast, _context);
};

export const evaluateExpr = async (
  ast: AbstractSyntaxTree,
  context: Context
): Promise<Exclude<EvalValue, null>> => {
  const result = await evaluateStatement(ast, context);
  assert(
    result !== null,
    SystemError.evaluationError(
      'expected a value',
      [],
      ast.data.position
    ).withFileId(context.fileId)
  );
  return result;
};

export const evaluateSequence = async (
  ast: AbstractSyntaxTree,
  context: Context
): Promise<EvalValue> => {
  let result: EvalValue = null;

  for (const child of ast.children) {
    result = await evaluateStatement(child, context);
  }

  return result;
};

export const evaluateScript = async (
  ast: AbstractSyntaxTree,
  context: Context
): Promise<EvalValue> => {
  assert(ast.type === NodeType.SCRIPT, 'expected script');
  return await evaluateSequence(ast, context);
};

export const evaluateModule = async (
  ast: AbstractSyntaxTree,
  context: Context
): Promise<Extract<EvalValue, { record: unknown }>> => {
  assert(ast.type === NodeType.MODULE, 'expected module');
  const record: Record<string | symbol, EvalValue> = {};

  for (const child of ast.children) {
    if (child.data.operator === OperatorType.IMPORT) {
      await evaluateStatement(child, context);
    } else if (child.data.operator === OperatorType.EXPORT) {
      const expr = child.children[0];
      const value = await evaluateExpr(expr, context);

      assert(
        !(ModuleDefault in record),
        SystemError.duplicateDefaultExport(expr.data.position).withFileId(
          context.fileId
        )
      );

      record[ModuleDefault] = value;
    } else {
      const [name, expr] = child.children;
      const value = await evaluateExpr(expr, context);
      await bindExport(name, value, record, context);
      await bind(name, value, context);
    }
  }

  return { record };
};

export const evaluateScriptString = async (
  input: string,
  context: Context
): Promise<EvalValue> => {
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);
  const [errors, validated] = validate(ast, context.fileId);

  if (errors.length > 0) {
    errors.forEach((e) => e.print());
    return null;
  }

  try {
    return await evaluateScript(validated, context);
  } catch (e) {
    console.error(e);
    if (e instanceof SystemError) e.print();

    return null;
  }
};

export const evaluateModuleString = async (
  input: string,
  context: Context
): Promise<Extract<EvalValue, { record: unknown }>> => {
  const tokens = parseTokens(input);
  const ast = parseModule(tokens);
  const [errors, validated] = validate(ast, context.fileId);

  if (errors.length > 0) {
    errors.forEach((e) => e.print());
    return { record: {} };
  }

  try {
    return await evaluateModule(validated, context);
  } catch (e) {
    console.error(e);
    if (e instanceof SystemError) e.print();

    return { record: {} };
  }
};

export const evaluateEntryFile = async (file: string, argv: string[] = []) => {
  const resolved = path.resolve(file);
  const root = path.dirname(resolved);
  const name = '/' + path.basename(resolved);
  register(Injectable.RootDir, root);
  const module = await getModule({ name });

  if ('script' in module) {
    return module.script;
  } else if ('module' in module) {
    const main = module.default;
    assert(
      typeof main === 'function',
      'default export from runnable module must be a function'
    );
    const fileId = inject(Injectable.FileMap).getFileId(file);
    const value = await main(argv, [
      { start: 0, end: 0 },
      0,
      newContext(fileId, file),
    ]);
    return value;
  }

  unreachable('file must be a script or a module');
};
