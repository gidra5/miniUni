import { Diagnostic, primaryDiagnosticLabel } from 'codespan-napi';
import { SystemError } from '../error.js';
import { getModule } from '../files.js';
import {
  getPosition,
  parseModule,
  parseScript,
  showNode,
  showPos,
} from '../parser.js';
import {
  NodeType,
  node,
  name as nameAST,
  placeholder,
  fn as fnAST,
  tuple as tupleAST,
  type Tree,
  ifElse,
  application,
  sequence,
  loop,
  block,
  tuple,
  implicitPlaceholder,
} from '../ast.js';
import { parseTokens } from '../tokens.js';
import {
  assert,
  eventLoopYield,
  getClosestName,
  inspect,
  isEqual,
  unreachable,
} from '../utils.js';
import {
  atom,
  awaitTask,
  CallSite,
  createChannel,
  createEffect,
  createHandler,
  createRecord,
  EvalFunction,
  EvalRecord,
  EvalValue,
  getChannel,
  isChannel,
  isEffect,
  isHandler,
  isRecord,
  isTask,
  receive,
  recordDelete,
  recordGet,
  recordHas,
  recordMerge,
  recordSet,
  send,
  tryReceive,
} from '../values.js';
import { validate } from '../validate.js';
import { inject, Injectable, register } from '../injector.js';
import path from 'node:path';
import { Environment } from '../environment.js';
import { Position } from '../position.js';
import {
  bind,
  bindContext,
  PatternTestEnvs,
  testPattern,
} from './patternMatching.js';
import { prelude, preludeHandlers, ReturnHandler } from '../std/prelude.js';
import { ModuleDefault } from '../module.js';
import { listMethods } from '../std/list.js';
import { stringMethods } from '../std/string.js';
import { CreateTaskEffect } from '../std/concurrency.js';
import { isResult, resultMethods } from '../std/result.js';

export type Context = {
  file: string;
  fileId: number;
  env: Environment;
};

export const forkContext = (context: Context): Context => {
  return {
    ...context,
    env: new Environment({ parent: context.env }),
  };
};

export const newContext = (fileId: number, file: string): Context => {
  return {
    file,
    fileId,
    env: new Environment({ parent: prelude }),
  };
};

const incAssign = (
  envs: PatternTestEnvs,
  context: Context,
  position: Position
) => {
  assert(envs.exports.size === 0, 'cant do exports at increment');
  assert(envs.env.size === 0, 'cant do mutable declarations at increment');

  for (const [patternKey, value] of envs.readonly.entries()) {
    if (typeof patternKey === 'string') {
      assert(
        !context.env.hasReadonly(patternKey),

        SystemError.immutableVariableAssignment(
          patternKey,
          position
        ).withFileId(context.fileId)
      );
      assert(
        context.env.has(patternKey),
        SystemError.invalidAssignment(
          patternKey,
          position,
          getClosestName(
            patternKey,
            context.env.keys().filter((k) => typeof k === 'string')
          )
        ).withFileId(context.fileId)
      );

      const v = context.env.get(patternKey);
      assert(
        typeof v === 'number',
        SystemError.invalidIncrement(String(patternKey), position).withFileId(
          context.fileId
        )
      );
      assert(
        typeof value === 'number',
        SystemError.invalidIncrement(String(patternKey), position).withFileId(
          context.fileId
        )
      );
      context.env.set(patternKey, v + value);
    } else {
      const [patternTarget, patternKeyValue] = patternKey;
      if (Array.isArray(patternTarget)) {
        assert(
          typeof patternKeyValue === 'number',
          SystemError.invalidIndex(position).withFileId(context.fileId)
        );
        const v = patternTarget[patternKeyValue];
        assert(
          typeof v === 'number',
          SystemError.invalidIncrement(
            String(patternKeyValue),
            position
          ).withFileId(context.fileId)
        );
        assert(
          typeof value === 'number',
          SystemError.invalidIncrement(
            String(patternKeyValue),
            position
          ).withFileId(context.fileId)
        );
        patternTarget[patternKeyValue] = v + value;
      } else {
        assert(isRecord(patternTarget), 'expected record');

        const v = recordGet(patternTarget, patternKeyValue);
        assert(
          typeof v === 'number',
          SystemError.invalidIncrement(
            String(patternKeyValue),
            position
          ).withFileId(context.fileId)
        );
        assert(
          typeof value === 'number',
          SystemError.invalidIncrement(
            String(patternKeyValue),
            position
          ).withFileId(context.fileId)
        );
        recordSet(patternTarget, patternKeyValue, v + value);
      }
    }
  }
};

const assign = (
  envs: PatternTestEnvs,
  context: Context,
  position: Position
) => {
  assert(envs.exports.size === 0, 'cant do exports in at assignment');
  assert(envs.env.size === 0, 'cant do mutable declarations at assignment');

  for (const [patternKey, value] of envs.readonly.entries()) {
    if (typeof patternKey === 'string') {
      assert(
        !context.env.hasReadonly(patternKey),
        SystemError.immutableVariableAssignment(
          patternKey,
          position
        ).withFileId(context.fileId)
      );
      assert(
        context.env.set(patternKey, value),
        SystemError.invalidAssignment(
          patternKey,
          position,
          getClosestName(
            patternKey,
            context.env.keys().filter((k) => typeof k === 'string')
          )
        ).withFileId(context.fileId)
      );
    } else {
      const [patternTarget, key] = patternKey;
      if (Array.isArray(patternTarget)) {
        assert(
          typeof key === 'number',
          SystemError.invalidIndex(position).withFileId(context.fileId)
        );
        patternTarget[key] = value;
      } else {
        assert(isRecord(patternTarget), 'expected record');
        if (value === null) recordDelete(patternTarget, key);
        else recordSet(patternTarget, key, value);
      }
    }
  }
};

function bindExport(
  envs: PatternTestEnvs,
  exports: EvalRecord,
  context: Context
) {
  for (const [key, value] of envs.readonly.entries()) {
    assert(typeof key === 'string', 'can only declare names');

    if (value === null) continue;
    assert(
      !context.env.has(key),
      'cannot declare name inside module more than once'
    );
    context.env.addReadonly(key, value);
  }

  for (const [key, value] of envs.env.entries()) {
    assert(typeof key === 'string', 'can only declare names');

    if (value === null) continue;
    assert(
      !context.env.has(key),
      'cannot declare name inside module more than once'
    );
    context.env.add(key, value);
  }

  for (const [key, value] of envs.exports.entries()) {
    assert(typeof key === 'string', 'can only declare names');
    assert(
      !context.env.has(key),
      'cannot declare name inside module more than once'
    );

    if (value === null) continue;
    context.env.addReadonly(key, value);
    recordSet(exports, key, value);
  }
}

const operators = {
  [NodeType.ADD]: (lhs: EvalValue, rhs: EvalValue) => {
    assert(
      typeof lhs === 'number' || typeof lhs === 'string' || isChannel(lhs),
      'expected number, channel or string on lhs'
    );
    assert(
      typeof lhs === typeof rhs,
      'expected both lhs and rhs have the same type'
    );

    if (isChannel(rhs)) {
      assert(isChannel(lhs));
      const c = createChannel('select');
      Promise.race([receive(rhs), receive(lhs)]).then((v) => send(c, v));
      return c;
    }

    return (lhs as string) + (rhs as string);
  },
  [NodeType.SUB]: (lhs: EvalValue, rhs: EvalValue) => {
    assert(typeof lhs === 'number', 'expected number');
    assert(typeof rhs === 'number', 'expected number');
    return lhs - rhs;
  },
  [NodeType.MULT]: (lhs: EvalValue, rhs: EvalValue) => {
    assert(typeof lhs === 'number', 'expected number');
    assert(typeof rhs === 'number', 'expected number');
    return lhs * rhs;
  },
  [NodeType.DIV]: (lhs: EvalValue, rhs: EvalValue) => {
    assert(typeof lhs === 'number', 'expected number');
    assert(typeof rhs === 'number', 'expected number');
    return lhs / rhs;
  },
  [NodeType.MOD]: (lhs: EvalValue, rhs: EvalValue) => {
    assert(typeof lhs === 'number', 'expected number');
    assert(typeof rhs === 'number', 'expected number');
    return lhs % rhs;
  },
  [NodeType.POW]: (lhs: EvalValue, rhs: EvalValue) => {
    assert(typeof lhs === 'number', 'expected number');
    assert(typeof rhs === 'number', 'expected number');
    return lhs ** rhs;
  },
  [NodeType.PLUS]: (arg: EvalValue) => {
    assert(typeof arg === 'number', 'expected number');
    return +arg;
  },
  [NodeType.MINUS]: (arg: EvalValue) => {
    assert(typeof arg === 'number', 'expected number');
    return -arg;
  },

  [NodeType.EQUAL]: (left: EvalValue, right: EvalValue) => {
    return left === right;
  },
  [NodeType.NOT_EQUAL]: (left: EvalValue, right: EvalValue) => {
    return !operators[NodeType.EQUAL](left, right);
  },
  [NodeType.DEEP_EQUAL]: (left: EvalValue, right: EvalValue) => {
    return isEqual(left, right);
  },
  [NodeType.DEEP_NOT_EQUAL]: (left: EvalValue, right: EvalValue) => {
    return !operators[NodeType.DEEP_EQUAL](left, right);
  },
  [NodeType.LESS]: (left: EvalValue, right: EvalValue) => {
    assert(typeof left === 'number', 'expected number');
    assert(typeof right === 'number', 'expected number');
    return left < right;
  },
  [NodeType.LESS_EQUAL]: (left: EvalValue, right: EvalValue) => {
    return (
      operators[NodeType.LESS](left, right) ||
      operators[NodeType.EQUAL](left, right)
    );
  },
  [NodeType.GREATER]: (left: EvalValue, right: EvalValue) => {
    return !operators[NodeType.LESS_EQUAL](left, right);
  },
  [NodeType.GREATER_EQUAL]: (left: EvalValue, right: EvalValue) => {
    return !operators[NodeType.LESS](left, right);
  },
  [NodeType.NOT]: (arg: EvalValue) => {
    assert(typeof arg === 'boolean', 'expected boolean');
    return !arg;
  },
  [NodeType.AWAIT]: async (task: EvalValue) => {
    assert(isTask(task), 'expected task');
    return await awaitTask(task);
  },
  [NodeType.IN]: (key: EvalValue, value: EvalValue) => {
    if (Array.isArray(value) && typeof key === 'number') {
      const v = value[key];
      return v !== null && v !== undefined;
    }
    if (isRecord(value)) {
      return recordHas(value, key);
    }
    unreachable('expected record or tuple');
  },
};

const MaskEffect = Symbol('effect mask');
const lazyOperators = {
  [NodeType.IMPORT]: async (ast: Tree, context: Context) => {
    const name = ast.data.name;
    const module = await getModule({ name, from: context.file });
    const value =
      'script' in module
        ? module.script
        : 'module' in module
        ? module.module
        : (module.buffer as unknown as EvalValue);
    const pattern = ast.children[0];
    if (pattern) {
      const result = await testPattern(pattern, value, context);
      assert(result.matched, 'expected pattern to match');
      bind(result.envs, context);
    }

    return value;
  },
  [NodeType.ASYNC]: async (ast: Tree, context: Context) => {
    const [expr] = ast.children;
    const task = async () =>
      await evaluateBlock(expr, context).catch((e) => {
        console.error(e);
        if (e instanceof SystemError) e.print();
        else showNode(expr, context, e.message);
        return null;
      });
    return createEffect(CreateTaskEffect, task, context.env);
  },
  [NodeType.PARALLEL]: async (ast: Tree, context: Context) => {
    const arg = ast.children[0];
    const task = await evaluateStatement(
      node(NodeType.ASYNC, { children: [arg] }),
      context
    );
    if (ast.children.length === 1) {
      return await mapEffect(task, context, async (task) => {
        return [task];
      });
    }
    return await flatMapEffect(task, context, async (task, context) => {
      const rest = await evaluateStatement(
        node(NodeType.PARALLEL, { children: ast.children.slice(1) }),
        context
      );
      return await flatMapEffect(rest, context, async (rest) => {
        assert(Array.isArray(rest), 'expected array');
        return [task, ...rest];
      });
    });
  },
  [NodeType.AND]: async (ast: Tree, context: Context) => {
    const [head, ...rest] = ast.children;
    const restAst =
      rest.length > 1 ? node(NodeType.AND, { children: rest }) : rest[0];
    const _node = ifElse(head, restAst, nameAST('false', getPosition(head)));
    return await evaluateStatement(_node, context);
  },
  [NodeType.OR]: async (ast: Tree, context: Context) => {
    const [head, ...rest] = ast.children;
    const restAst =
      rest.length > 1 ? node(NodeType.OR, { children: rest }) : rest[0];
    const _node = ifElse(head, nameAST('true', getPosition(head)), restAst);
    return await evaluateStatement(_node, context);
  },

  [NodeType.PARENS]: async (ast: Tree, context: Context) => {
    const [arg] = ast.children;
    if (arg.type === NodeType.IMPLICIT_PLACEHOLDER) return [];
    return await evaluateStatement(arg, context);
  },
  [NodeType.SQUARE_BRACKETS]: async (ast: Tree, context: Context) => {
    const [arg] = ast.children;
    if (arg.type === NodeType.IMPLICIT_PLACEHOLDER) return [];
    const key = await evaluateStatement(arg, context);
    return context.env.get(key);
  },

  [NodeType.INJECT]: async (ast: Tree, context: Context) => {
    const [expr, body] = ast.children;
    const value = await evaluateExpr(expr, context);

    return await flatMapEffect(value, context, async (value, context) => {
      assert(isRecord(value), 'expected record');
      const result = await evaluateBlock(body, context);
      return await evaluateHandlers(value, result, getPosition(body), context);
    });
  },
  [NodeType.WITHOUT]: async (ast: Tree, context: Context) => {
    const [expr, body] = ast.children;
    let value = await evaluateExpr(expr, context);
    return await flatMapEffect(value, context, async (without, context) => {
      if (!Array.isArray(without)) without = [without];

      const result = await evaluateBlock(body, context);
      assert(
        !isEffect(result) || !without.includes(result.effect),
        `effects from ${without.map((x) => String(x))} were disallowed`
      );
      return result;
    });
  },
  [NodeType.MASK]: async (ast: Tree, context: Context) => {
    const [expr, body] = ast.children;
    let value = await evaluateExpr(expr, context);
    return await flatMapEffect(value, context, async (mask, context) => {
      if (!Array.isArray(mask)) mask = [mask];

      const _mask = async (result: EvalValue, context: Context) => {
        if (!isEffect(result)) return result;
        if (!mask.includes(result.effect)) return result;

        return createEffect(MaskEffect, result.effect, context.env, [
          async () => result,
        ]);
      };
      let result = await evaluateBlock(body, context);
      return await _mask(result, context);
    });
  },

  [NodeType.IS]: async (ast: Tree, context: Context) => {
    const [value, pattern] = ast.children;
    const v = await evaluateStatement(value, context);
    return await flatMapEffect(v, context, async (v, context) => {
      const result = await testPattern(pattern, v, context);
      return result.matched;
    });
  },
  [NodeType.MATCH]: async (ast: Tree, context: Context) => {
    const [expr, ...branches] = ast.children;
    const value = await evaluateExpr(expr, context);
    return await flatMapEffect(value, context, async (value, context) => {
      for (const branch of branches) {
        assert(branch.type === NodeType.MATCH_CASE, 'expected match case');
        const [pattern, body] = branch.children;

        const result = await testPattern(pattern, value, context);
        if (result.matched) {
          return await evaluateBlock(body, bindContext(result.envs, context));
        }
      }

      return null;
    });
  },
  [NodeType.IF]: async (ast: Tree, context: Context) => {
    const [condition, branch] = ast.children;
    const falseBranch = placeholder(getPosition(branch));
    const _node = ifElse(condition, branch, falseBranch);
    return await evaluateStatement(_node, context);
  },
  [NodeType.IF_ELSE]: async (ast: Tree, context: Context) => {
    const [condition, trueBranch, falseBranch] = ast.children;
    if (condition.type === NodeType.IS) {
      const [value, pattern] = condition.children;
      const v = await evaluateStatement(value, context);

      return await flatMapEffect(v, context, async (v, context) => {
        const result = await testPattern(pattern, v, context);
        if (result.matched) {
          return await evaluateBlock(
            trueBranch,
            bindContext(result.envs, context)
          );
        } else {
          return await evaluateBlock(
            falseBranch,
            bindContext(result.notEnvs, context)
          );
        }
      });
    }

    const result = await evaluateExpr(condition, context);
    return await flatMapEffect(result, context, async (result, context) => {
      if (result) return await evaluateBlock(trueBranch, context);
      else return await evaluateBlock(falseBranch, context);
    });
  },
  [NodeType.WHILE]: async (ast: Tree, context: Context) => {
    const [condition, body] = ast.children;
    const _break = application(
      nameAST('break', getPosition(condition)),
      placeholder(getPosition(condition))
    );
    const _node = loop(ifElse(condition, body, _break));
    return await evaluateStatement(_node, context);
  },
  [NodeType.FOR]: async (ast: Tree, context: Context) => {
    const [pattern, expr, body] = ast.children;
    const list = await evaluateExpr(expr, context);
    return await flatMapEffect(list, context, async (list, context) => {
      assert(
        Array.isArray(list),
        SystemError.evaluationError(
          'for loop iterates over lists only.',
          [],
          getPosition(expr)
        )
      );
      const breakHandler: EvalFunction = async (cs, v) => {
        assert(Array.isArray(v), 'expected value to be an array');
        const [_callback, value] = v;
        return ['break', value];
      };
      const continueHandler: EvalFunction = async (cs, v) => {
        assert(Array.isArray(v), 'expected value to be an array');
        const [_callback, value] = v;
        return ['continue', value];
      };
      const handlers = createRecord({
        [atom('continue')]: createHandler(continueHandler),
        [atom('break')]: createHandler(breakHandler),
        [ReturnHandler]: async (cs, v) => ['continue', v],
      });

      const mapped: EvalValue[] = [];
      for (const item of list) {
        const result = await testPattern(pattern, item, context);
        assert(result.matched, 'expected pattern to match');
        const bound = bindContext(result.envs, context);
        const value = await evaluateHandlers(
          handlers,
          await evaluateStatement(body, bound),
          getPosition(expr),
          bound
        );
        assert(Array.isArray(value), 'expected value to be an array');
        const [status, _value] = value;

        if (status === 'break') {
          if (_value !== null) mapped.push(_value);
          break;
        }
        if (status === 'continue') {
          if (_value !== null) mapped.push(_value);
          continue;
        }
      }

      return mapped;
    });
  },
  [NodeType.LOOP]: async (ast: Tree, context: Context) => {
    let [body] = ast.children;
    if (body.type === NodeType.BLOCK) {
      body = body.children[0];
    }
    const _continue = application(
      nameAST('continue', getPosition(body)),
      placeholder(getPosition(body))
    );
    const _block = block(sequence([body, _continue]));
    return await evaluateStatement(_block, context);
  },

  [NodeType.BLOCK]: async (ast: Tree, context: Context) => {
    const [expr] = ast.children;
    if (expr.type === NodeType.IMPLICIT_PLACEHOLDER) return null;
    const breakHandler: EvalFunction = async (cs, v) => {
      assert(Array.isArray(v), 'expected value to be an array');
      const [_callback, value] = v;
      return value;
    };
    const continueHandler: EvalFunction = async (cs, _v) => {
      await eventLoopYield();
      return await evaluateStatement(block(expr), context);
    };
    const handlers = createRecord({
      [atom('continue')]: createHandler(continueHandler),
      [atom('break')]: createHandler(breakHandler),
    });

    return await evaluateHandlers(
      handlers,
      await evaluateBlock(expr, context),
      getPosition(expr),
      context
    );
  },
  [NodeType.SEQUENCE]: async (ast: Tree, context: Context) => {
    const [expr, ...rest] = ast.children;
    if (expr.type === NodeType.IMPLICIT_PLACEHOLDER) return null;

    const v = await evaluateStatement(expr, context);
    if (rest.length === 0) return v;

    return await flatMapEffect(v, context, (_, context) =>
      evaluateStatement(sequence(rest), context)
    );
  },

  [NodeType.INCREMENT]: async (ast: Tree, context: Context) => {
    const [arg] = ast.children;
    assert(arg.type === NodeType.NAME, 'expected name');
    const value = await evaluateExpr(arg, context);
    return await flatMapEffect(value, context, async (value, context) => {
      assert(typeof value === 'number', 'expected number');
      const { matched, envs } = await testPattern(arg, value + 1, context);
      assert(matched, 'expected pattern to match');
      assign(envs, context, getPosition(arg));
      return value + 1;
    });
  },
  [NodeType.DECREMENT]: async (ast: Tree, context: Context) => {
    const [arg] = ast.children;
    assert(arg.type === NodeType.NAME, 'expected name');
    const value = await evaluateExpr(arg, context);
    return await flatMapEffect(value, context, async (value, context) => {
      assert(typeof value === 'number', 'expected number');
      const { matched, envs } = await testPattern(arg, value - 1, context);
      assert(matched, 'expected pattern to match');
      assign(envs, context, getPosition(arg));
      return value - 1;
    });
  },
  [NodeType.POST_DECREMENT]: async (ast: Tree, context: Context) => {
    const [arg] = ast.children;
    assert(arg.type === NodeType.NAME, 'expected name');
    const value = await evaluateExpr(arg, context);
    return await flatMapEffect(value, context, async (value, context) => {
      assert(typeof value === 'number', 'expected number');
      const { matched, envs } = await testPattern(arg, value - 1, context);
      assert(matched, 'expected pattern to match');
      assign(envs, context, getPosition(arg));
      return value;
    });
  },
  [NodeType.POST_INCREMENT]: async (ast: Tree, context: Context) => {
    const [arg] = ast.children;
    assert(arg.type === NodeType.NAME, 'expected name');
    const value = await evaluateExpr(arg, context);
    return await flatMapEffect(value, context, async (value, context) => {
      assert(typeof value === 'number', 'expected number');
      const { matched, envs } = await testPattern(arg, value + 1, context);
      assert(matched, 'expected pattern to match');
      assign(envs, context, getPosition(arg));
      return value;
    });
  },

  [NodeType.DECLARE]: async (ast: Tree, _context: Context) => {
    const [pattern, expr] = ast.children;
    const value = await evaluateStatement(expr, _context);
    return await flatMapEffect(value, _context, async (value, context) => {
      const result = await testPattern(pattern, value, context);
      assert(result.matched, 'expected pattern to match');
      bind(result.envs, context);
      return value;
    });
  },
  [NodeType.ASSIGN]: async (ast: Tree, _context: Context) => {
    const [pattern, expr] = ast.children;
    const value = await evaluateStatement(expr, _context);
    return await flatMapEffect(value, _context, async (value, context) => {
      const { matched, envs } = await testPattern(pattern, value, context);
      assert(matched, 'expected pattern to match');
      assign(envs, context, getPosition(pattern));
      return value;
    });
  },
  [NodeType.INC_ASSIGN]: async (ast: Tree, _context: Context) => {
    const [pattern, expr] = ast.children;
    const value = await evaluateExpr(expr, _context);
    return await flatMapEffect(value, _context, async (value, context) => {
      assert(typeof value === 'number' || Array.isArray(value));
      const { matched, envs } = await testPattern(pattern, value, context);
      assert(matched, 'expected pattern to match');
      incAssign(envs, context, getPosition(pattern));
      return value;
    });
  },

  [NodeType.LABEL]: async (ast: Tree, context: Context) => {
    return await evaluateStatement(tuple([ast]), context);
  },
  [NodeType.TUPLE]: async (ast: Tree, context: Context) => {
    const children = ast.children.slice();
    if (children.length === 0) return [];
    const head = children.pop()!;
    if (head.type === NodeType.IMPLICIT_PLACEHOLDER) return [];
    if (head.type === NodeType.PLACEHOLDER) return [];

    const _tail = await evaluateStatement(tuple(children), context);
    return await flatMapEffect(_tail, context, async (_tail, context) => {
      assert(
        isRecord(_tail) || Array.isArray(_tail),
        'expected record or tuple'
      );

      const op =
        tupleOperators[head.type as keyof typeof tupleOperators] ??
        tupleOperators[NodeType.TUPLE];
      return await op(head, _tail, context);
    });
  },
  [NodeType.INDEX]: async (ast: Tree, context: Context) => {
    const [_target, _index] = ast.children;
    const target = await evaluateExpr(_target, context);
    return await flatMapEffect(target, context, async (target, context) => {
      const index = await evaluateExpr(_index, context);

      return await flatMapEffect(index, context, async (index, context) => {
        if (
          isResult(target) &&
          typeof index === 'string' &&
          index in resultMethods
        ) {
          return await resultMethods[index](
            [getPosition(_index), context],
            target
          );
        }

        if (Array.isArray(target)) {
          if (!Number.isInteger(index)) {
            assert(
              typeof index === 'string',
              SystemError.invalidIndex(getPosition(_index)).withFileId(
                context.fileId
              )
            );
            return await listMethods[index](
              [getPosition(_index), context],
              target
            );
          }
          return target[index as number] ?? null;
        } else if (isRecord(target)) {
          const v = recordGet(target, index);
          assert(
            v !== null,
            SystemError.invalidIndex(getPosition(_index)).withFileId(
              context.fileId
            )
          );
          return v;
        }

        if (typeof target === 'string') {
          assert(
            typeof index === 'string' && index in stringMethods,
            SystemError.invalidIndex(getPosition(_index)).withFileId(
              context.fileId
            )
          );
          return await stringMethods[index](
            [getPosition(_index), context],
            target
          );
        }

        unreachable(
          SystemError.invalidIndexTarget(getPosition(_index)).withFileId(
            context.fileId
          )
        );
      });
    });
  },

  [NodeType.PIPE]: async (ast: Tree, context: Context) => {
    const args = ast.children.slice();
    assert(args.length >= 2, 'expected at least one more argument');
    const fnArg = args.pop()!;

    const rest =
      args.length === 1
        ? await evaluateExpr(args[0], context)
        : await evaluateExpr(node(NodeType.PIPE, { children: args }), context);

    return await flatMapEffect(rest, context, async (rest, context) => {
      let fn = await evaluateStatement(fnArg, context);
      return await flatMapEffect(fn, context, async (fn, context) => {
        assert(typeof fn === 'function', 'expected function');
        return await fn([getPosition(fnArg), context], rest);
      });
    });
  },
  [NodeType.SEND]: async (ast: Tree, context: Context) => {
    const [chanAst, valueAst] = ast.children;
    const channelValue = await evaluateExpr(chanAst, context);
    return await flatMapEffect(
      channelValue,
      context,
      async (channelValue, context) => {
        assert(
          isChannel(channelValue),
          SystemError.invalidSendChannel(getPosition(chanAst)).withFileId(
            context.fileId
          )
        );
        const channel = getChannel(channelValue);

        assert(
          channel,
          SystemError.channelClosed(getPosition(chanAst)).withFileId(
            context.fileId
          )
        );

        const value = await evaluateExpr(valueAst, context);

        return await flatMapEffect(value, context, async (value, context) => {
          const promise = channel.onReceive.shift();
          if (!promise) {
            channel.queue.push(value);
            return null;
          }
          const { resolve, reject } = promise;
          if (value instanceof Error) reject(value);
          else resolve(value);

          return null;
        });
      }
    );
  },
  [NodeType.CODE_LABEL]: async (ast: Tree, context: Context) => {
    const expr = ast.children[0];
    const label = Symbol(ast.data.name);
    const labelHandler: EvalFunction = async (cs, v) => {
      assert(Array.isArray(v), 'expected v to be an array');
      const [_callback, value] = v;
      assert(Array.isArray(value), 'expected value to be an array');
      const [status, _value] = value;
      if (status === 'break') return _value;
      if (status === 'continue') {
        return await evaluateStatement(ast, context);
      }
      return null;
    };
    const handlers = createRecord({
      [label]: createHandler(labelHandler),
    });
    const labelBreak: EvalFunction = async (cs, value) => {
      return createEffect(label, ['break', value], cs[1].env);
    };
    const labelContinue: EvalFunction = async (cs, value) => {
      await eventLoopYield();
      return createEffect(label, ['continue', value], cs[1].env);
    };
    const forked = forkContext(context);
    forked.env.addReadonly(
      ast.data.name,
      createRecord({
        break: labelBreak,
        continue: labelContinue,
      })
    );

    return await evaluateHandlers(
      handlers,
      await evaluateStatement(expr, forked),
      getPosition(expr),
      forked
    );
  },
  [NodeType.RECEIVE]: async (ast: Tree, context: Context) => {
    const channelValue = await evaluateExpr(ast.children[0], context);

    return await flatMapEffect(
      channelValue,
      context,
      async (channelValue, context) => {
        assert(
          isChannel(channelValue),
          SystemError.invalidReceiveChannel(getPosition(ast)).withFileId(
            context.fileId
          )
        );

        return await receive(channelValue).catch((e) => {
          assert(
            e !== 'channel closed',
            SystemError.channelClosed(getPosition(ast)).withFileId(
              context.fileId
            )
          );
          throw e;
        });
      }
    );
  },
  [NodeType.SEND_STATUS]: async (ast: Tree, context: Context) => {
    const channelValue = await evaluateExpr(ast.children[0], context);
    return await flatMapEffect(
      channelValue,
      context,
      async (channelValue, context) => {
        assert(
          isChannel(channelValue),
          SystemError.invalidSendChannel(getPosition(ast)).withFileId(
            context.fileId
          )
        );

        const value = await evaluateExpr(ast.children[1], context);

        return await flatMapEffect(value, context, async (value, context) => {
          const status = send(channelValue, value);
          return atom(status);
        });
      }
    );
  },
  [NodeType.RECEIVE_STATUS]: async (ast: Tree, context: Context) => {
    const channelValue = await evaluateExpr(ast.children[0], context);

    return await flatMapEffect(
      channelValue,
      context,
      async (channelValue, context) => {
        assert(
          isChannel(channelValue),
          SystemError.invalidReceiveChannel(getPosition(ast)).withFileId(
            context.fileId
          )
        );

        const [value, status] = tryReceive(channelValue);

        if (value instanceof Error) throw value;
        return [value ?? [], atom(status)];
      }
    );
  },

  [NodeType.FUNCTION]: async (ast: Tree, context: Context) => {
    const [_patterns, _body] = ast.children;
    const isTopFunction = ast.data.isTopFunction ?? true;
    const patterns =
      _patterns.type !== NodeType.TUPLE ? [_patterns] : _patterns.children;
    const pattern = patterns[0];
    const rest = patterns.slice(1);
    const body =
      rest.length === 0
        ? _body
        : fnAST(tupleAST(rest), _body, { isTopFunction: false });

    const _context = forkContext(context);
    const self: EvalFunction = async (cs, arg) => {
      const [position, callerContext] = cs;
      const fileId = callerContext.fileId;
      await eventLoopYield();
      const result = await testPattern(pattern, arg, _context);
      assert(
        result.matched,
        SystemError.evaluationError(
          'expected pattern to match',
          [],
          getPosition(pattern)
        )
          .withPrimaryLabel('called here', position, fileId)
          .withFileId(context.fileId)
      );
      const bound = bindContext(result.envs, _context);
      if (isTopFunction) {
        bound.env.addReadonly('self', self);
      }

      if (body.type === NodeType.IMPLICIT_PLACEHOLDER) return null;

      const returnHandler: EvalFunction = async (cs, v) => {
        assert(Array.isArray(v), 'expected value to be an array');
        const [_callback, value] = v;
        return value;
      };

      const _result = await evaluateHandlers(
        createRecord({ [atom('return')]: createHandler(returnHandler) }),
        await evaluateStatement(body, bound),
        getPosition(body),
        bound
      );

      return _result;
    };
    return self;
  },
  [NodeType.APPLICATION]: async (ast: Tree, context: Context) => {
    const [fnExpr, argStmt] = ast.children;
    const fnValue = await evaluateExpr(fnExpr, context);
    const _argExpr =
      argStmt.type === NodeType.BLOCK
        ? fnAST(implicitPlaceholder(getPosition(argStmt)), argStmt, {
            isTopFunction: false,
          })
        : argStmt;

    return await flatMapEffect(fnValue, context, async (fnValue, context) => {
      assert(
        typeof fnValue === 'function',
        SystemError.invalidApplicationExpression(
          getPosition(fnExpr)
        ).withFileId(context.fileId)
      );

      const argValue = await evaluateStatement(_argExpr, context);
      return await flatMapEffect(
        argValue,
        context,
        async (argValue, context) => {
          const x = await fnValue([getPosition(ast), context], argValue);

          return await replaceEffectContext(x, context);
        }
      );
    });
  },

  [NodeType.TRY]: async (ast: Tree, context: Context) => {
    const result = await evaluateExpr(ast.children[0], context);
    return await flatMapEffect(result, context, async (value, context) => {
      if (isResult(value)) {
        const [status, result] = value;
        if (status === atom('ok')) return result;
        if (status === atom('error')) {
          return createEffect(atom('return'), value, context.env);
        }
      }
      return value;
    });
  },
} satisfies Record<
  PropertyKey,
  (ast: Tree, context: Context) => Promise<EvalValue>
>;

const tupleOperators = {
  [NodeType.SPREAD]: async (
    head: Tree,
    _tuple: EvalValue[] | EvalRecord,
    context: Context
  ) => {
    const v = await evaluateExpr(head.children[0], context);
    return await flatMapEffect(v, context, async (v, _context) => {
      if (Array.isArray(_tuple) && Array.isArray(v)) {
        return [..._tuple, ...v];
      }
      if (isRecord(_tuple) && isRecord(v)) {
        return recordMerge(_tuple, v);
      }
      unreachable('inconsistent spread types');
    });
  },
  [NodeType.LABEL]: async (
    head: Tree,
    _tuple: EvalValue[] | EvalRecord,
    context: Context
  ) => {
    const _key = head.children[0];
    const k =
      _key.type === NodeType.NAME
        ? _key.data.value
        : _key.type === NodeType.SQUARE_BRACKETS
        ? await evaluateExpr(_key.children[0], context)
        : await evaluateExpr(_key, context);

    return await flatMapEffect(k, context, async (key, context) => {
      const v = await evaluateExpr(head.children[1], context);
      return await flatMapEffect(v, context, async (value, _context) => {
        if (Array.isArray(_tuple) && _tuple.length === 0)
          return createRecord([[key, value]]);
        assert(isRecord(_tuple), 'expected record');
        recordSet(_tuple, key, value);
        return _tuple;
      });
    });
  },
  [NodeType.TUPLE]: async (
    head: Tree,
    _tuple: EvalValue[] | EvalRecord,
    context: Context
  ) => {
    const v = await evaluateExpr(head, context);
    assert(Array.isArray(_tuple), 'expected array');
    return await flatMapEffect(v, context, async (v, _context) => [
      ..._tuple,
      v,
    ]);
  },
} satisfies Record<
  PropertyKey,
  (
    ast: Tree,
    _tuple: EvalValue[] | EvalRecord,
    context: Context
  ) => Promise<EvalValue>
>;

export const evaluateHandlers = async (
  handlers: EvalRecord,
  value: EvalValue,
  position: Position,
  context: Context
): Promise<EvalValue> => {
  const cs: CallSite = [position, context];

  if (!isEffect(value)) {
    const returnHandler = recordGet(handlers, ReturnHandler);
    if (returnHandler === null) return value;
    assert(
      typeof returnHandler === 'function',
      'expected return handler to be a function'
    );
    return returnHandler(cs, value);
  }
  if (value.effect === MaskEffect && recordHas(handlers, value.value)) {
    const r = await runEffectContinuations(value.continuations, cs, null);
    return await mapEffect(r, context, async (value, context) => {
      return await evaluateHandlers(handlers, value, position, context);
    });
  }

  if (!recordHas(handlers, value.effect)) {
    return await mapEffect(value, context, async (value, context) => {
      return await evaluateHandlers(handlers, value, position, context);
    });
  }

  const env = value.env.copyUpTo(context.env);
  const callback: EvalFunction = async (cs, _value) => {
    value.env.replace(env, context.env);
    const __value = await runEffectContinuations(
      value.continuations,
      cs,
      _value
    );
    const result = await evaluateHandlers(handlers, __value, position, context);
    return result;
  };

  const handlerValue = recordGet(handlers, value.effect);
  if (!isHandler(handlerValue)) return await callback(cs, handlerValue);

  const { handler } = handlerValue;
  return await handler([position, context], [callback, value.value]);
};

const replaceEffectContext = async (
  value: EvalValue,
  context: Context
): Promise<EvalValue> => {
  if (!isEffect(value)) return value;
  const updated = createEffect(
    value.effect,
    value.value,
    context.env,
    value.continuations
  );
  return await flatMapEffect(updated, context, replaceEffectContext);
};

const mapEffect = async (
  value: EvalValue,
  context: Context,
  map: (v: EvalValue, context: Context) => Promise<EvalValue>
): Promise<EvalValue> => {
  if (isEffect(value)) {
    value.continuations.push(async (cs, v) => map(v, context));
    return value;
  }
  return await map(value, context);
};

const flatMapEffect = async (
  value: EvalValue,
  context: Context,
  map: (v: EvalValue, context: Context) => Promise<EvalValue>
): Promise<EvalValue> => {
  if (isEffect(value)) {
    return await mapEffect(value, context, async (value, context) => {
      value = await replaceEffectContext(value, context);
      return await flatMapEffect(value, context, map);
    });
  }
  return await map(value, context);
};

const runEffectContinuations = async (
  continuations: EvalFunction[],
  cs: CallSite,
  v: EvalValue
) => {
  for (const continuation of continuations) {
    v = await continuation(cs, v);
  }
  return v;
};

export const evaluateStatement = async (
  ast: Tree,
  context: Context
): Promise<EvalValue> => {
  if (ast.type in lazyOperators) {
    const op = lazyOperators[ast.type as keyof typeof lazyOperators];
    const v = await op(ast, context);
    if (v instanceof Error) throw v;
    return v;
  }

  if (ast.type in operators) {
    const children = ast.children.slice();
    const fst = children.pop()!;

    const fstValue = await evaluateExpr(fst, context);

    if (children.length === 0) {
      return await flatMapEffect(
        fstValue,
        context,
        async (fstValue, _context) => {
          return operators[ast.type](fstValue);
        }
      );
    }

    return await flatMapEffect(fstValue, context, async (fstValue, context) => {
      if (children.length === 1) {
        const snd = children.pop()!;
        const sndValue = await evaluateExpr(snd, context);
        return await flatMapEffect(
          sndValue,
          context,
          async (sndValue, _context) => {
            return operators[ast.type](sndValue, fstValue);
          }
        );
      }

      const restAst = node(ast.type, { children });
      const restValue = await evaluateExpr(restAst, context);
      return await flatMapEffect(
        restValue,
        context,
        async (restValue, _context) => {
          return operators[ast.type](restValue, fstValue);
        }
      );
    });
  }

  switch (ast.type) {
    case NodeType.ATOM: {
      return atom(ast.data.name);
    }

    case NodeType.NAME: {
      const name = ast.data.value;
      if (name === 'true') return true;
      if (name === 'false') return false;
      assert(
        context.env.has(name),
        SystemError.undeclaredName(name, getPosition(ast)).withFileId(
          context.fileId
        )
      );
      return context.env.get(name);
    }
    case NodeType.NUMBER:
    case NodeType.STRING:
      return ast.data.value;
    case NodeType.PLACEHOLDER:
      return null;
    case NodeType.IMPLICIT_PLACEHOLDER:
      unreachable(
        SystemError.invalidPlaceholderExpression(getPosition(ast)).withFileId(
          context.fileId
        )
      );
    case NodeType.ERROR:
      unreachable(ast.data.cause.withFileId(context.fileId));

    case NodeType.SPREAD: {
      unreachable(
        SystemError.invalidUseOfSpread(getPosition(ast)).withFileId(
          context.fileId
        )
      );
    }
    default:
      return null;
  }
};

const evaluateBlock = async (
  ast: Tree,
  context: Context
): Promise<EvalValue> => {
  const _context = forkContext(context);
  return await evaluateStatement(ast, _context);
};

export const evaluateExpr = async (
  ast: Tree,
  context: Context
): Promise<Exclude<EvalValue, null>> => {
  const result = await evaluateStatement(ast, context);
  return (await flatMapEffect(result, context, async (result, context) => {
    assert(
      result !== null,
      SystemError.evaluationError(
        'expected a value',
        [],
        getPosition(ast)
      ).withFileId(context.fileId)
    );
    return result;
  })) as Exclude<EvalValue, null>;
};

export const evaluateScript = async (
  ast: Tree,
  context: Context
): Promise<EvalValue> => {
  assert(ast.type === NodeType.SCRIPT, 'expected script');
  return evaluateHandlers(
    preludeHandlers,
    await evaluateStatement(sequence(ast.children), context),
    getPosition(ast),
    context
  );
};

export const evaluateModule = async (
  ast: Tree,
  context: Context
): Promise<EvalRecord> => {
  assert(ast.type === NodeType.MODULE, 'expected module');
  const record: EvalRecord = createRecord();

  for (const child of ast.children) {
    if (child.type === NodeType.DECLARE) {
      const [pattern, expr] = child.children;
      const value = await evaluateExpr(expr, context);
      const { matched, envs } = await testPattern(pattern, value, context);
      assert(matched, 'expected pattern to match');
      bindExport(envs, record, context);
    } else if (child.type === NodeType.EXPORT) {
      const value = await evaluateExpr(child.children[0], context);

      assert(
        !recordHas(record, ModuleDefault),
        SystemError.duplicateDefaultExport(
          getPosition(child.children[0])
        ).withFileId(context.fileId)
      );

      recordSet(record, ModuleDefault, value);
    } else {
      await evaluateStatement(child, context);
    }
  }

  return record;
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
): Promise<EvalRecord> => {
  const tokens = parseTokens(input);
  const ast = parseModule(tokens);
  const [errors, validated] = validate(ast, context.fileId);

  if (errors.length > 0) {
    errors.forEach((e) => e.print());
    return createRecord();
  }

  try {
    return await evaluateModule(validated, context);
  } catch (e) {
    console.error(e);
    if (e instanceof SystemError) e.print();

    return createRecord();
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
    const value = await main(
      [{ start: 0, end: 0 }, newContext(fileId, file)],
      argv
    );
    return value;
  }

  unreachable('file must be a script or a module');
};
