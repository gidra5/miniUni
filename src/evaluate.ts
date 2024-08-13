import { Diagnostic, primaryDiagnosticLabel } from 'codespan-napi';
import { SystemError } from './error.js';
import {
  fileMap,
  getModule,
  getScriptResult,
  isScript,
  prelude,
} from './files.js';
import {
  NodeType,
  OperatorType,
  parseModule,
  parseScript,
  type AbstractSyntaxTree,
} from './parser.js';
import { parseTokens, symbols } from './tokens.js';
import { assert, getClosestName, inspect, omit, unreachable } from './utils.js';
import {
  atom,
  createChannel,
  EvalFunction,
  EvalValue,
  getChannel,
  isChannel,
  isRecord,
  isSymbol,
  send,
} from './values.js';

export type Context = {
  file: string;
  fileId: number;
  env: Record<string, EvalValue>;
};

const forkEnv = (env: Record<string, EvalValue>): Record<string, EvalValue> => {
  const forked: Record<string, EvalValue> = {};
  Object.setPrototypeOf(forked, env);
  return forked;
};

export const newContext = (fileId: number, file: string): Context => {
  return { file, fileId, env: { ...prelude } };
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
    context.env[name] = v + value;
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
    list[index] = value;
    return context;
  }

  if (patternAst.type === NodeType.NAME) {
    const env = { ...context.env };
    const name = patternAst.data.value;
    assert(
      name in env,
      SystemError.invalidAssignment(
        name,
        patternAst.data.position,
        getClosestName(name, Object.keys(env))
      ).withFileId(context.fileId)
    );
    env[name] = value;
    context.env = env;
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
        context.env[name] = record[name];
        consumedNames.push(name);
        continue;
      } else if (pattern.data.operator === OperatorType.COLON) {
        const [key, valuePattern] = pattern.children;
        const name = key.data.value;
        consumedNames.push(name);
        context = await bind(valuePattern, record[name], context);
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
    const env = { ...context.env };
    const name = patternAst.data.value;
    env[name] = value;
    context.env = env;
    return context;
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
    if (exporting) exports[name] = value;
    return exports;
  }

  unreachable(
    SystemError.invalidPattern(patternAst.data.position).withFileId(
      context.fileId
    )
  );
}

export const evaluateExpr = async (
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
    diag.emitStd(fileMap);
  };
  switch (ast.type) {
    case NodeType.OPERATOR: {
      switch (ast.data.operator) {
        case OperatorType.IMPORT: {
          const name = ast.data.name;
          const module = await getModule(name, context.file);
          assert(
            !Buffer.isBuffer(module),
            'binary file import is not supported'
          );
          const value = isScript(module)
            ? getScriptResult(module)
            : { record: module };
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
          const arg = evaluateExpr(ast.children[0], context);
          return -arg;
        }
        case OperatorType.PLUS: {
          const arg = evaluateExpr(ast.children[0], context);
          return +arg;
        }
        case OperatorType.INCREMENT: {
          const arg = ast.children[0];
          assert(arg.type === 'name', 'expected name');
          const value = await evaluateExpr(arg, context);
          assert(typeof value === 'number', 'expected number');
          await assign(arg, value + 1, context);
          return value + 1;
        }
        case OperatorType.DECREMENT: {
          const arg = ast.children[0];
          assert(arg.type === 'name', 'expected name');
          const value = await evaluateExpr(arg, context);
          assert(typeof value === 'number', 'expected number');
          await assign(arg, value - 1, context);
          return value - 1;
        }
        case OperatorType.POST_DECREMENT: {
          const arg = ast.children[0];
          assert(arg.type === 'name', 'expected name');
          const value = await evaluateExpr(arg, context);
          assert(typeof value === 'number', 'expected number');
          await assign(arg, value - 1, context);
          return value;
        }
        case OperatorType.POST_INCREMENT: {
          const arg = ast.children[0];
          assert(arg.type === 'name', 'expected name');
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
        case OperatorType.NOT: {
          const arg = await evaluateExpr(ast.children[0], context);
          return !arg;
        }
        case OperatorType.PARENS:
          if (ast.children[0].type === 'implicit_placeholder') return [];
          return await evaluateExpr(ast.children[0], context);

        case OperatorType.INDEX: {
          const [list, index] = await Promise.all(
            ast.children.map((child) => evaluateExpr(child, context))
          );

          if (Array.isArray(list)) {
            assert(
              Number.isInteger(index),
              SystemError.invalidIndex(ast.data.position).withFileId(
                context.fileId
              )
            );
            assert(typeof index === 'number');
            return list[index];
          } else if (isRecord(list)) {
            const record = list.record;
            assert(
              typeof index === 'string',
              SystemError.invalidIndex(ast.data.position).withFileId(
                context.fileId
              )
            );
            return record[index];
          }

          unreachable(
            SystemError.invalidIndexTarget(ast.data.position).withFileId(
              context.fileId
            )
          );
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
          unreachable(
            SystemError.invalidUseOfSpread(ast.data.position).withFileId(
              context.fileId
            )
          );

        case OperatorType.PARALLEL: {
          const _channels = ast.children.map((child) => {
            const channel = createChannel();
            evaluateExpr(child, { ...context }).then(
              (value) => send(channel.channel, value),
              (e) => send(channel.channel, e)
            );

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

          channel.onReceive = channel.onReceive.filter(
            (_promise) => _promise !== promise
          );
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

          const channel = getChannel(channelValue.channel);

          assert(
            channel,
            SystemError.channelClosed(ast.data.position).withFileId(
              context.fileId
            )
          );

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

          const channel = getChannel(channelValue.channel);

          if (!channel) {
            return atom('closed');
          }

          const promise = channel.onReceive.shift();
          if (!promise) return atom('none');

          const { resolve, reject } = promise;
          if (value instanceof Error) reject(value);
          else resolve(value);

          channel.onReceive = channel.onReceive.filter(
            (_promise) => _promise !== promise
          );
          return atom('sent');
        }
        case OperatorType.RECEIVE_STATUS: {
          const channelValue = await evaluateExpr(ast.children[0], context);

          assert(
            isChannel(channelValue),
            SystemError.invalidReceiveChannel(ast.data.position).withFileId(
              context.fileId
            )
          );

          const channel = getChannel(channelValue.channel);

          if (!channel) {
            return atom('closed');
          }

          if (channel.queue.length > 0) {
            const next = channel.queue.shift()!;
            if (next instanceof Error) throw next;
            return [atom('received'), next];
          }

          return atom('empty');
        }

        case OperatorType.ATOM:
          assert(ast.children[0].type === 'name', 'expected name');
          return atom(ast.children[0].data.value);

        case OperatorType.TOKEN:
          unreachable(
            SystemError.invalidTokenExpression(ast.data.position).withFileId(
              context.fileId
            )
          );

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
          while (true) {
            try {
              const cond = await evaluateExpr(condition, context);
              if (!cond) break;
              result = await evaluateExpr(body, context);
            } catch (e) {
              if (typeof e === 'object' && e !== null && 'break' in e) {
                result = e.break as EvalValue;
                break;
              }
              if (typeof e === 'object' && e !== null && 'continue' in e) {
                result = e.continue as EvalValue;
                continue;
              }
              throw e;
            }
          }
          return result;
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
            try {
              const bound = await bind(pattern, item, context);
              const value = await evaluateExpr(body, bound);
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
          const [body] = ast.children;
          const collected: EvalValue[] = [];

          while (true) {
            try {
              const value = await evaluateExpr(body, context);
              if (value === null) continue;
              collected.push(value);
            } catch (e) {
              if (typeof e === 'object' && e !== null && 'break' in e) {
                const value = e.break as EvalValue;
                if (value !== null) collected.push(value);
                break;
              }
              if (typeof e === 'object' && e !== null && 'continue' in e) {
                const value = e.continue as EvalValue;
                if (value !== null) collected.push(value);
                continue;
              }
              throw e;
            }
          }
          return collected;
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
          const [fnExpr, argStmt] = ast.children;
          const [fnValue, argValue] = await Promise.all([
            evaluateExpr(fnExpr, context),
            evaluateExpr(argStmt, context),
          ]);

          assert(
            typeof fnValue === 'function',
            SystemError.invalidApplicationExpression(
              ast.data.position
            ).withFileId(context.fileId)
          );

          return await fnValue(argValue, [ast.data.position, context.fileId]);
        }
      }
    }

    case NodeType.NAME:
      const name = ast.data.value;
      if (name === 'true') return true;
      if (name === 'false') return false;
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
        SystemError.invalidPlaceholderExpression()
          .withNode(ast)
          .withFileId(context.fileId)
      );
    case NodeType.ERROR:
      unreachable(ast.data.cause.withFileId(context.fileId));
    default:
      return null;
  }
};

export const evaluateSequence = async (
  ast: AbstractSyntaxTree,
  context: Context
): Promise<EvalValue> => {
  let result: EvalValue = null;

  for (const child of ast.children) {
    result = await evaluateExpr(child, context);
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
  const record: Record<string, EvalValue> = {};

  for (const child of ast.children) {
    if (child.data.operator === OperatorType.IMPORT) {
      await evaluateExpr(child, context);
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
  try {
    return await evaluateScript(ast, context);
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
  try {
    return await evaluateModule(ast, context);
  } catch (e) {
    console.error(e);
    if (e instanceof SystemError) e.print();

    return { record: {} };
  }
};
