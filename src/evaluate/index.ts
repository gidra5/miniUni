import { SystemError } from '../error.js';
import { getModule } from '../files.js';
import { getPosition, parseModule, parseScript, showNode } from '../parser.js';
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
  number,
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
  cancelTask,
  createChannel,
  createEffect,
  createHandler,
  createRecord,
  createTask,
  EvalFunction,
  EvalRecord,
  EvalTask,
  EvalValue,
  getChannel,
  isChannel,
  isEffect,
  isHandler,
  isPrototyped,
  isRecord,
  isTask,
  onceEvent,
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
  compilePattern,
  PatternTestEnvs,
} from './patternMatching.js';
import { prelude, preludeHandlers, ReturnHandler } from '../std/prelude.js';
import { ModuleDefault } from '../module.js';
import { listPrototype } from '../std/list.js';
import { stringPrototype } from '../std/string.js';
import { CreateTaskEffect } from '../std/concurrency.js';
import { createOk, isResult } from '../std/result.js';

export type EvalContext = {
  env: Environment;
};
export type CompileContext = {
  file: string;
  fileId: number;
};
export type Executable = (env: EvalContext) => Promise<EvalValue>;
type Compiler = (ast: Tree, context: CompileContext) => Executable;

export const forkContext = (context: EvalContext): EvalContext => {
  return { ...context, env: new Environment({ parent: context.env }) };
};

export const newCompileContext = (
  fileId: number,
  file: string
): CompileContext => {
  return { file, fileId };
};

export const newContext = (): EvalContext => {
  const env = new Environment({ parent: prelude });
  return { env };
};

const incAssign = (position: Position, context: CompileContext) => {
  const invalidIndex = SystemError.invalidIndex(position).withFileId(
    context.fileId
  );
  const invalidName = (name: string) =>
    SystemError.invalidIncrement(name, position).withFileId(context.fileId);
  const immutableName = (name: string) =>
    SystemError.immutableVariableAssignment(name, position).withFileId(
      context.fileId
    );
  const undeclaredName = (name: string, names: string[]) =>
    SystemError.undeclaredNameAssignment(
      name,
      position,
      getClosestName(name, names)
    ).withFileId(context.fileId);
  return (envs: PatternTestEnvs, context: EvalContext) => {
    assert(envs.exports.size === 0, 'cant do exports at increment');
    assert(envs.env.size === 0, 'cant do mutable declarations at increment');

    for (const [patternKey, value] of envs.readonly.entries()) {
      if (typeof patternKey === 'symbol') {
        assert(
          !context.env.hasReadonly(patternKey),
          immutableName(patternKey.description!)
        );
        assert(
          context.env.has(patternKey),
          undeclaredName(
            patternKey.description!,
            context.env.keys().map((k) => k.description ?? String(k))
          )
        );

        const v = context.env.get(patternKey);
        assert(
          typeof v === 'number' || typeof v === 'string',
          invalidName(String(patternKey))
        );
        assert(typeof value === typeof v, invalidName(String(patternKey)));
        context.env.set(patternKey, (v as string) + (value as string));
      } else {
        const [patternTarget, patternKeyValue] = patternKey;
        if (Array.isArray(patternTarget)) {
          assert(typeof patternKeyValue === 'number', invalidIndex);
          const v = patternTarget[patternKeyValue];
          assert(typeof v === 'number', invalidName(String(patternKeyValue)));
          assert(
            typeof value === 'number',
            invalidName(String(patternKeyValue))
          );
          patternTarget[patternKeyValue] = v + value;
        } else {
          assert(isRecord(patternTarget), 'expected record');

          const v = recordGet(patternTarget, patternKeyValue);
          assert(typeof v === 'number', invalidName(String(patternKeyValue)));
          assert(
            typeof value === 'number',
            invalidName(String(patternKeyValue))
          );
          recordSet(patternTarget, patternKeyValue, v + value);
        }
      }
    }
  };
};

const assign = (position: Position, context: CompileContext) => {
  const invalidIndex = SystemError.invalidIndex(position).withFileId(
    context.fileId
  );
  const immutableName = (name: string) =>
    SystemError.immutableVariableAssignment(name, position).withFileId(
      context.fileId
    );
  const undeclaredName = (name: string, names: string[]) =>
    SystemError.undeclaredNameAssignment(
      name,
      position,
      getClosestName(name, names)
    ).withFileId(context.fileId);

  return (envs: PatternTestEnvs, context: EvalContext) => {
    assert(envs.exports.size === 0, 'cant do exports in at assignment');
    assert(envs.env.size === 0, 'cant do mutable declarations at assignment');

    for (const [patternKey, value] of envs.readonly.entries()) {
      if (typeof patternKey === 'symbol') {
        assert(
          !context.env.hasReadonly(patternKey),
          immutableName(patternKey.description!)
        );
        assert(
          context.env.set(patternKey, value),
          undeclaredName(
            patternKey.description!,
            context.env.keys().map((k) => k.description ?? String(k))
          )
        );
      } else {
        const [patternTarget, key] = patternKey;
        if (Array.isArray(patternTarget)) {
          assert(typeof key === 'number', invalidIndex);
          patternTarget[key] = value;
        } else {
          assert(isRecord(patternTarget), 'expected record');
          if (value === null) recordDelete(patternTarget, key);
          else recordSet(patternTarget, key, value);
        }
      }
    }
  };
};

const bindExport = (context: CompileContext) => {
  return (envs: PatternTestEnvs, exports: EvalRecord, context: EvalContext) => {
    for (const [key, value] of envs.readonly.entries()) {
      assert(typeof key === 'symbol', 'can only declare names');

      if (value === null) continue;
      assert(
        !context.env.has(key),
        'cannot declare name inside module more than once'
      );
      context.env.addReadonly(key, value);
    }

    for (const [key, value] of envs.env.entries()) {
      assert(typeof key === 'symbol', 'can only declare names');

      if (value === null) continue;
      assert(
        !context.env.has(key),
        'cannot declare name inside module more than once'
      );
      context.env.add(key, value);
    }

    for (const [key, value] of envs.exports.entries()) {
      assert(typeof key === 'symbol', 'can only declare names');
      assert(
        !context.env.has(key),
        'cannot declare name inside module more than once'
      );

      if (value === null) continue;
      context.env.addReadonly(key, value);
      recordSet(exports, key, value);
    }
  };
};

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
const FnTryEffect = Symbol('fn try');
const lazyOperators = {
  [NodeType.IMPORT]: (ast, context) => {
    const name = ast.data.name;
    const pattern = ast.children[0];
    const importModule = async () => {
      const module = await getModule({ name, from: context.file });
      const value =
        'script' in module
          ? module.script
          : 'module' in module
          ? module.module
          : (module.buffer as unknown as EvalValue);

      return value;
    };

    if (pattern) {
      const compiledPattern = compilePattern(pattern, context);
      return async (evalContext) => {
        const value = await importModule();
        const result = await compiledPattern(value, evalContext);
        assert(result.matched, 'expected pattern to match');
        bind(result.envs, evalContext);
        return value;
      };
    }

    return importModule;
  },
  [NodeType.ASYNC]: (ast, context) => {
    const [expr] = ast.children;
    const compiled = compileBlock(expr, context);
    const exprPosition = getPosition(expr);
    return async (evalContext) => {
      const childrenTasks: EvalTask[] = [];
      const task = async () => {
        const handlers = createRecord({
          [CreateTaskEffect]: createHandler(async (cs, value) => {
            assert(Array.isArray(value), 'expected value to be an array');
            const [callback, taskFn] = value;
            assert(typeof taskFn === 'function', 'expected function');
            const _task = createTask(cs, async () => await taskFn(cs, null));
            childrenTasks.push(_task);
            assert(typeof callback === 'function', 'expected callback');
            return await callback(cs, _task);
          }),
        });
        const value = await compiled(evalContext).catch((e) => {
          if (e instanceof SystemError) e.print();
          else showNode(expr, context, e.message);
          return null;
        });

        return await handleEffects(
          handlers,
          value,
          exprPosition,
          evalContext,
          context
        );
      };
      const effect = createEffect(CreateTaskEffect, task, evalContext.env);
      return mapEffect(effect, evalContext, async (task) => {
        assert(isTask(task), 'expected task');
        const cancelEvent = task[1];
        onceEvent(cancelEvent, async (cs) => {
          for (const childTask of childrenTasks)
            await cancelTask(cs, childTask);
          return null;
        });
        return task;
      });
    };
  },
  [NodeType.PARALLEL]: (ast, context) => {
    const arg = ast.children[0];
    const compiled = compileStatement(
      node(NodeType.ASYNC, { children: [arg] }),
      context
    );

    if (ast.children.length === 1) {
      return async (context) => {
        const task = await compiled(context);
        return await mapEffect(task, context, async (task) => {
          return [task];
        });
      };
    }

    const restCompiled = compileStatement(
      node(NodeType.PARALLEL, { children: ast.children.slice(1) }),
      context
    );
    return async (context) => {
      const task = await compiled(context);
      return await flatMapEffect(task, context, async (task, context) => {
        const rest = await restCompiled(context);
        return await flatMapEffect(rest, context, async (rest) => {
          assert(Array.isArray(rest), 'expected array');
          return [task, ...rest];
        });
      });
    };
  },
  [NodeType.AND]: (ast, context) => {
    const [head, ...rest] = ast.children;
    const restAst =
      rest.length > 1 ? node(NodeType.AND, { children: rest }) : rest[0];
    const _node = ifElse(head, restAst, nameAST('false', getPosition(head)));
    return compileStatement(_node, context);
  },
  [NodeType.OR]: (ast, context) => {
    const [head, ...rest] = ast.children;
    const restAst =
      rest.length > 1 ? node(NodeType.OR, { children: rest }) : rest[0];
    const _node = ifElse(head, nameAST('true', getPosition(head)), restAst);
    return compileStatement(_node, context);
  },

  [NodeType.PARENS]: (ast, context) => {
    const [arg] = ast.children;
    if (arg.type === NodeType.IMPLICIT_PLACEHOLDER) return async () => [];
    return compileStatement(arg, context);
  },
  [NodeType.SQUARE_BRACKETS]: (ast, context) => {
    const [arg] = ast.children;
    assert(arg.type !== NodeType.IMPLICIT_PLACEHOLDER, 'expected expression');
    const compiled = compileStatement(arg, context);
    return async (context) => {
      const key = await compiled(context);
      assert(typeof key === 'symbol', 'dynamic name must be a symbol');
      return context.env.get(key);
    };
  },

  [NodeType.INJECT]: (ast, context) => {
    const [expr, body] = ast.children;
    // showNode(expr, context);
    const compiledExpr = compileExpr(expr, context);
    const compiledBlock = compileBlock(body, context);
    const bodyPosition = getPosition(body);

    return async (evalContext) => {
      const value = await compiledExpr(evalContext);
      return await flatMapEffect(
        value,
        evalContext,
        async (value, evalContext) => {
          assert(isRecord(value), 'expected record');
          const result = await compiledBlock(evalContext);
          return await handleEffects(
            value,
            result,
            bodyPosition,
            evalContext,
            context
          );
        }
      );
    };
  },
  [NodeType.WITHOUT]: (ast, context) => {
    const [expr, body] = ast.children;
    const compiledExpr = compileExpr(expr, context);
    const compiledBlock = compileBlock(body, context);

    return async (context) => {
      let value = await compiledExpr(context);
      return await flatMapEffect(value, context, async (without, context) => {
        if (!Array.isArray(without)) without = [without];

        const result = await compiledBlock(context);
        assert(
          !isEffect(result) || !without.includes(result.effect),
          `effects from ${without.map((x) => String(x))} were disallowed`
        );
        return result;
      });
    };
  },
  [NodeType.MASK]: (ast, context) => {
    const [expr, body] = ast.children;
    const compiledExpr = compileExpr(expr, context);
    const compiledBlock = compileBlock(body, context);
    return async (context) => {
      let value = await compiledExpr(context);
      return await flatMapEffect(value, context, async (mask, context) => {
        if (!Array.isArray(mask)) mask = [mask];
        let result = await compiledBlock(context);

        const _mask = async (result: EvalValue, context: EvalContext) => {
          if (!isEffect(result)) return result;
          if (!mask.includes(result.effect)) return result;

          return createEffect(MaskEffect, result.effect, context.env, [
            async () => result,
          ]);
        };
        return await _mask(result, context);
      });
    };
  },

  [NodeType.IS]: (ast, context) => {
    const [value, pattern] = ast.children;
    const compiled = compileStatement(value, context);
    const compiledPattern = compilePattern(pattern, context);
    return async (context) => {
      const v = await compiled(context);
      return await flatMapEffect(v, context, async (v, context) => {
        const result = await compiledPattern(v, context);
        return result.matched;
      });
    };
  },
  [NodeType.MATCH]: (ast, context) => {
    const [expr, ...branches] = ast.children;
    const compiled = compileExpr(expr, context);
    const compiledBranches = branches.map((branch) => {
      assert(branch.type === NodeType.MATCH_CASE, 'expected match case');
      const [pattern, body] = branch.children;
      const compiledBody = compileBlock(body, context);
      const compiledPattern = compilePattern(pattern, context);
      return [compiledPattern, compiledBody] as const;
    });

    return async (context) => {
      const value = await compiled(context);
      return await flatMapEffect(value, context, async (value, context) => {
        for (const branch of compiledBranches) {
          const [pattern, body] = branch;
          const result = await pattern(value, context);
          if (result.matched) {
            return await body(bindContext(result.envs, context));
          }
        }

        return null;
      });
    };
  },
  [NodeType.IF]: (ast, context) => {
    const [condition, branch] = ast.children;
    const falseBranch = placeholder(getPosition(branch));
    const _node = ifElse(condition, branch, falseBranch);

    return compileStatement(_node, context);
  },
  [NodeType.IF_ELSE]: (ast, context) => {
    const [condition, trueBranch, falseBranch] = ast.children;
    const compiledTrueBranch = compileBlock(trueBranch, context);
    const compiledFalseBranch = compileBlock(falseBranch, context);
    if (condition.type === NodeType.IS) {
      const [value, pattern] = condition.children;
      const compiledValue = compileStatement(value, context);
      const compiledPattern = compilePattern(pattern, context);
      return async (context) => {
        const v = await compiledValue(context);

        return await flatMapEffect(v, context, async (v, context) => {
          const result = await compiledPattern(v, context);
          if (result.matched) {
            return await compiledTrueBranch(bindContext(result.envs, context));
          } else {
            return await compiledFalseBranch(
              bindContext(result.notEnvs, context)
            );
          }
        });
      };
    }
    const compiledCondition = compileExpr(condition, context);

    return async (context) => {
      const result = await compiledCondition(context);
      return await flatMapEffect(result, context, async (result, context) => {
        if (result) return await compiledTrueBranch(context);
        else return await compiledFalseBranch(context);
      });
    };
  },
  [NodeType.FOR]: (ast, context) => {
    /* 
      mut iter := expr
      mut mapped := ()
      while iter.length != 0 {
        (pattern, ...rest) := iter
        if body is value do mapped = (...mapped, value)
        iter = rest
      }
    */

    const declare = (pattern: Tree, expr: Tree, position: Position) =>
      node(NodeType.DECLARE, {
        children: [pattern, expr],
        position,
      });
    const declareMut = (name: Tree, expr: Tree, position: Position) =>
      declare(
        node(NodeType.MUTABLE, { children: [name], position }),
        expr,
        position
      );
    const assign = (name: Tree, expr: Tree) =>
      node(NodeType.ASSIGN, { children: [name, expr] });
    const whileAST = (cond: Tree, body: Tree) =>
      node(NodeType.WHILE, { children: [cond, body] });
    const notEq = (lhs: Tree, rhs: Tree) =>
      node(NodeType.NOT_EQUAL, { children: [lhs, rhs] });
    const index = (lhs: Tree, rhs: Tree) =>
      node(NodeType.INDEX, { children: [lhs, rhs] });
    const atomAST = (name: string, position: Position) =>
      node(NodeType.ATOM, { data: { name }, position });
    const spread = (pattern: Tree) =>
      node(NodeType.SPREAD, { children: [pattern] });
    const ifAST = (cond: Tree, body: Tree) =>
      node(NodeType.IF, { children: [cond, body] });

    const [pattern, expr, body] = ast.children;
    const pos = getPosition(body);
    const iterName = nameAST('iter', pos);
    const mappedName = nameAST('mapped', pos);
    const restName = nameAST('rest', pos);
    const valueName = nameAST('value', pos);
    const declareIter = declareMut(iterName, expr, pos);
    const declareMapped = declareMut(mappedName, tupleAST([]), pos);
    const loopBody = sequence([
      declare(tupleAST([pattern, spread(restName)]), iterName, pos),
      ifAST(
        node(NodeType.IS, { children: [body, valueName] }),
        assign(mappedName, tupleAST([spread(mappedName), valueName]))
      ),
      assign(iterName, restName),
    ]);
    const loopIter = whileAST(
      notEq(index(iterName, atomAST('length', pos)), number(0, pos)),
      loopBody
    );
    return compileExpr(
      block(sequence([declareIter, declareMapped, loopIter, mappedName])),
      context
    );
  },
  [NodeType.WHILE]: (ast, context) => {
    /* 
      loop {
        if condition do body 
        else break()
      }
    */
    const [condition, body] = ast.children;
    const _break = application(
      nameAST('break', getPosition(condition)),
      placeholder(getPosition(condition))
    );
    const _node = loop(ifElse(condition, body, _break));
    return compileStatement(_node, context);
  },
  [NodeType.LOOP]: (ast, context) => {
    /* 
      {
        body
        continue()
      }
    */

    let [body] = ast.children;
    if (body.type === NodeType.BLOCK) {
      body = body.children[0];
    }
    const _continue = application(
      nameAST('continue', getPosition(body)),
      placeholder(getPosition(body))
    );
    const _block = block(sequence([body, _continue]));

    return compileStatement(_block, context);
  },

  [NodeType.BLOCK]: (ast, context) => {
    const [expr] = ast.children;
    if (expr.type === NodeType.IMPLICIT_PLACEHOLDER) return async () => null;

    const compiledExpr = compileBlock(expr, context);
    const exprPosition = getPosition(expr);
    const breakHandler: EvalFunction = async (cs, v) => {
      assert(Array.isArray(v), 'expected value to be an array');
      const [_callback, value] = v;
      return value;
    };
    const continueHandler: EvalFunction = async (cs, _v) => {
      await eventLoopYield();
      return await compiled(cs[1]);
    };
    const continueAtom = atom('continue');
    const breakAtom = atom('break');
    const handlers = createRecord({
      [continueAtom]: createHandler(continueHandler),
      [breakAtom]: createHandler(breakHandler),
    });
    const compiled: Executable = async (evalContext) => {
      const value = await compiledExpr(evalContext);
      return await handleEffects(
        handlers,
        value,
        exprPosition,
        evalContext,
        context
      );
    };
    return compiled;
  },
  [NodeType.SEQUENCE]: (ast, context) => {
    const [expr, ...rest] = ast.children;
    if (expr.type === NodeType.IMPLICIT_PLACEHOLDER) return async () => null;

    const compiledExpr = compileStatement(expr, context);
    if (rest.length === 0) return compiledExpr;

    const compiledRest = compileStatement(sequence(rest), context);

    return async (context) => {
      const v = await compiledExpr(context);
      return await flatMapEffect(v, context, (_, context) =>
        compiledRest(context)
      );
    };
  },

  [NodeType.INCREMENT]: (ast, context) => {
    const [arg] = ast.children;
    assert(arg.type === NodeType.NAME, 'expected name');
    const compiledAsExpr = compileExpr(arg, context);
    const compiledAsPattern = compilePattern(arg, context);
    const argPosition = getPosition(arg);
    const compiledAssign = assign(argPosition, context);

    return async (context) => {
      const value = await compiledAsExpr(context);
      return await flatMapEffect(value, context, async (value, context) => {
        assert(typeof value === 'number', 'expected number');
        const { matched, envs } = await compiledAsPattern(value + 1, context);
        assert(matched, 'expected pattern to match');
        compiledAssign(envs, context);
        return value + 1;
      });
    };
  },
  [NodeType.DECREMENT]: (ast, context) => {
    const [arg] = ast.children;
    assert(arg.type === NodeType.NAME, 'expected name');
    const compiledAsExpr = compileExpr(arg, context);
    const compiledAsPattern = compilePattern(arg, context);
    const argPosition = getPosition(arg);
    const compiledAssign = assign(argPosition, context);

    return async (context) => {
      const value = await compiledAsExpr(context);
      return await flatMapEffect(value, context, async (value, context) => {
        assert(typeof value === 'number', 'expected number');
        const { matched, envs } = await compiledAsPattern(value - 1, context);
        assert(matched, 'expected pattern to match');
        compiledAssign(envs, context);
        return value - 1;
      });
    };
  },
  [NodeType.POST_DECREMENT]: (ast, context) => {
    const [arg] = ast.children;
    assert(arg.type === NodeType.NAME, 'expected name');
    const compiledAsExpr = compileExpr(arg, context);
    const compiledAsPattern = compilePattern(arg, context);
    const argPosition = getPosition(arg);
    const compiledAssign = assign(argPosition, context);

    return async (context) => {
      const value = await compiledAsExpr(context);
      return await flatMapEffect(value, context, async (value, context) => {
        assert(typeof value === 'number', 'expected number');
        const { matched, envs } = await compiledAsPattern(value - 1, context);
        assert(matched, 'expected pattern to match');
        compiledAssign(envs, context);
        return value;
      });
    };
  },
  [NodeType.POST_INCREMENT]: (ast, context) => {
    const [arg] = ast.children;
    assert(arg.type === NodeType.NAME, 'expected name');
    const compiledAsExpr = compileExpr(arg, context);
    const compiledAsPattern = compilePattern(arg, context);
    const argPosition = getPosition(arg);
    const compiledAssign = assign(argPosition, context);

    return async (context) => {
      const value = await compiledAsExpr(context);
      return await flatMapEffect(value, context, async (value, context) => {
        assert(typeof value === 'number', 'expected number');
        const { matched, envs } = await compiledAsPattern(value + 1, context);
        assert(matched, 'expected pattern to match');
        compiledAssign(envs, context);
        return value;
      });
    };
  },

  [NodeType.DECLARE]: (ast, context) => {
    const [pattern, expr] = ast.children;
    const compiledExpr = compileStatement(expr, context);
    const compiledPattern = compilePattern(pattern, context);

    return async (_context) => {
      const value = await compiledExpr(_context);
      return await flatMapEffect(value, _context, async (value, context) => {
        const result = await compiledPattern(value, context);
        assert(result.matched, 'expected pattern to match');
        bind(result.envs, context);
        return value;
      });
    };
  },
  [NodeType.ASSIGN]: (ast, context) => {
    const [pattern, expr] = ast.children;
    const compiledExpr = compileStatement(expr, context);
    const compiledPattern = compilePattern(pattern, context);
    const compiledAssign = assign(getPosition(pattern), context);

    return async (_context) => {
      const value = await compiledExpr(_context);
      return await flatMapEffect(value, _context, async (value, context) => {
        const { matched, envs } = await compiledPattern(value, context);
        assert(matched, 'expected pattern to match');
        compiledAssign(envs, context);
        return value;
      });
    };
  },
  [NodeType.INC_ASSIGN]: (ast, context) => {
    const [pattern, expr] = ast.children;
    const compiledExpr = compileExpr(expr, context);
    const compiledPattern = compilePattern(pattern, context);
    const patternPosition = getPosition(pattern);
    const compiledIncAssign = incAssign(patternPosition, context);

    return async (_context) => {
      const value = await compiledExpr(_context);
      return await flatMapEffect(value, _context, async (value, context) => {
        assert(
          typeof value === 'number' ||
            Array.isArray(value) ||
            typeof value === 'string'
        );
        const { matched, envs } = await compiledPattern(value, context);
        assert(matched, 'expected pattern to match');
        compiledIncAssign(envs, context);
        return value;
      });
    };
  },

  [NodeType.LABEL]: (ast, context) => {
    return compileStatement(tuple([ast]), context);
  },
  [NodeType.TUPLE]: (ast, context) => {
    const children = ast.children.slice();
    if (children.length === 0) return async () => [];
    const head = children.pop()!;
    if (head.type === NodeType.IMPLICIT_PLACEHOLDER) return async () => [];
    if (head.type === NodeType.PLACEHOLDER) return async () => [];

    const opCompiler =
      tupleOperators[head.type as keyof typeof tupleOperators] ??
      tupleOperators[NodeType.TUPLE];
    const compiledOp = opCompiler(head, context);

    if (children.length === 0) {
      return async (context) => {
        return await compiledOp([], context);
      };
    }

    const compiledTail = compileExpr(tuple(children), context);

    return async (context) => {
      const _tail = await compiledTail(context);
      return await flatMapEffect(_tail, context, async (_tail, context) => {
        assert(
          isRecord(_tail) || Array.isArray(_tail),
          'expected record or tuple'
        );
        return await compiledOp(_tail, context);
      });
    };
  },
  [NodeType.INDEX]: (ast, context) => {
    const [_target, _index] = ast.children;
    const compiledTarget = compileExpr(_target, context);
    const compiledIndex = compileExpr(_index, context);
    const targetPosition = getPosition(_target);
    const indexPosition = getPosition(_index);
    const invalidIndexTargetError = SystemError.invalidIndexTarget(
      targetPosition
    ).withFileId(context.fileId);
    const invalidIndexError = SystemError.invalidIndex(
      indexPosition
    ).withFileId(context.fileId);

    const indexTarget = async (
      target: EvalValue,
      index: EvalValue,
      evalContext: EvalContext
    ) => {
      if (isPrototyped(target)) {
        const targetValue = target.value;
        // const targetIndexValue = await indexTarget(
        //   targetValue,
        //   index,
        //   evalContext
        // );
        // if (targetIndexValue !== null) return targetIndexValue;

        if (isRecord(targetValue) && recordHas(targetValue, index)) {
          return recordGet(targetValue, index);
        }

        if (Array.isArray(target) && Number.isInteger(index)) {
          return target[index as number] ?? null;
        }

        const prototypes = target.prototypes;

        for (const prototype of prototypes) {
          const method = await indexTarget(prototype, index, evalContext);
          if (method === null) continue;

          assert(typeof method === 'function', 'expected function');
          return await method(
            [indexPosition, evalContext, context],
            targetValue
          );
        }

        return null;
      }

      if (typeof target === 'string') {
        return await indexTarget(
          { prototypes: [stringPrototype], value: target },
          index,
          evalContext
        );
      }

      if (Array.isArray(target) && !Number.isInteger(index)) {
        return await indexTarget(
          { prototypes: [listPrototype], value: target },
          index,
          evalContext
        );
      }

      if (Array.isArray(target)) {
        return target[index as number] ?? null;
      }

      if (isRecord(target)) {
        return recordGet(target, index);
      }

      unreachable(invalidIndexTargetError);
    };

    return async (evalContext) => {
      const target = await compiledTarget(evalContext);
      return await flatMapEffect(
        target,
        evalContext,
        async (target, evalContext) => {
          const index = await compiledIndex(evalContext);

          return await flatMapEffect(
            index,
            evalContext,
            async (index, evalContext) =>
              await indexTarget(target, index, evalContext)
          );
        }
      );
    };
  },

  [NodeType.PIPE]: (ast, context) => {
    const args = ast.children.slice();
    const fn = args.pop()!;
    assert(args.length >= 1, 'expected at least one more argument');

    return compileStatement(
      application(
        fn,
        args.length === 1 ? args[0] : node(NodeType.PIPE, { children: args })
      ),
      context
    );
  },
  [NodeType.SEND]: (ast, context) => {
    const [chanAst, valueAst] = ast.children;
    const compiledExpr = compileExpr(chanAst, context);
    const compiledValue = compileExpr(valueAst, context);
    const invalidSendChannelError = SystemError.invalidSendChannel(
      getPosition(chanAst)
    ).withFileId(context.fileId);
    const channelClosedError = SystemError.channelClosed(
      getPosition(chanAst)
    ).withFileId(context.fileId);

    return async (context) => {
      const channelValue = await compiledExpr(context);
      return await flatMapEffect(
        channelValue,
        context,
        async (channelValue, context) => {
          assert(isChannel(channelValue), invalidSendChannelError);

          const channel = getChannel(channelValue);
          assert(channel, channelClosedError);

          const value = await compiledValue(context);

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
    };
  },
  [NodeType.CODE_LABEL]: (ast, context) => {
    const compiledExpr = compileStatement(ast.children[0], context);
    const exprPosition = getPosition(ast.children[0]);
    const label = Symbol(ast.data.name);
    const labelHandler: EvalFunction = async (cs, v) => {
      assert(Array.isArray(v), 'expected v to be an array');
      const [_callback, value] = v;
      assert(Array.isArray(value), 'expected value to be an array');
      const [status, _value] = value;
      if (status === 'break') return _value;
      if (status === 'continue') {
        return await compiled(cs[1]);
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
    const labelRecord = createRecord({
      break: labelBreak,
      continue: labelContinue,
    });
    const labelAtom = atom(ast.data.name);
    const compiled: Executable = async (evalContext) => {
      const forked = forkContext(evalContext);
      forked.env.addReadonly(labelAtom, labelRecord);

      return await handleEffects(
        handlers,
        await compiledExpr(forked),
        exprPosition,
        forked,
        context
      );
    };
    return compiled;
  },
  [NodeType.RECEIVE]: (ast, context) => {
    const compiledExpr = compileExpr(ast.children[0], context);
    const invalidReceiveChannelError = SystemError.invalidReceiveChannel(
      getPosition(ast)
    ).withFileId(context.fileId);
    const channelClosedError = SystemError.channelClosed(
      getPosition(ast)
    ).withFileId(context.fileId);
    return async (context) => {
      const channelValue = await compiledExpr(context);

      return await flatMapEffect(
        channelValue,
        context,
        async (channelValue, context) => {
          assert(isChannel(channelValue), invalidReceiveChannelError);
          return await receive(channelValue).catch((e) => {
            assert(e !== 'channel closed', channelClosedError);
            throw e;
          });
        }
      );
    };
  },
  [NodeType.SEND_STATUS]: (ast, context) => {
    const compiledExpr = compileExpr(ast.children[0], context);
    const compiledValue = compileExpr(ast.children[1], context);
    const invalidSendChannelError = SystemError.invalidSendChannel(
      getPosition(ast)
    ).withFileId(context.fileId);
    return async (context) => {
      const channelValue = await compiledExpr(context);
      return await flatMapEffect(
        channelValue,
        context,
        async (channelValue, context) => {
          assert(isChannel(channelValue), invalidSendChannelError);

          const value = await compiledValue(context);
          return await flatMapEffect(value, context, async (value, context) => {
            const status = send(channelValue, value);
            return atom(status);
          });
        }
      );
    };
  },
  [NodeType.RECEIVE_STATUS]: (ast, context) => {
    const compiledExpr = compileExpr(ast.children[0], context);
    const invalidReceiveChannelError = SystemError.invalidReceiveChannel(
      getPosition(ast)
    ).withFileId(context.fileId);
    return async (context) => {
      const channelValue = await compiledExpr(context);

      return await flatMapEffect(
        channelValue,
        context,
        async (channelValue) => {
          assert(isChannel(channelValue), invalidReceiveChannelError);

          const [value, status] = tryReceive(channelValue);
          if (value instanceof Error) throw value;
          return [value ?? [], atom(status)];
        }
      );
    };
  },

  [NodeType.FUNCTION]: (ast, context) => {
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
    const bodyPosition = getPosition(_body);
    const compiledBody = compileStatement(body, context);
    const compiledPattern = compilePattern(pattern, context);
    const matchError = (position: Position, fileId: number) =>
      SystemError.evaluationError(
        'expected pattern to match',
        [],
        getPosition(pattern)
      )
        .withPrimaryLabel('called here', position, fileId)
        .withFileId(context.fileId);

    if (body.type === NodeType.IMPLICIT_PLACEHOLDER) {
      return async (context) => {
        const _context = forkContext(context);
        return async (cs, arg) => {
          const [position, _, callerCompileContext] = cs;
          const fileId = callerCompileContext.fileId;
          const result = await compiledPattern(arg, _context);
          assert(result.matched, matchError(position, fileId));
          return null;
        };
      };
    }

    const returnHandler: EvalFunction = async (cs, v) => {
      assert(Array.isArray(v), 'expected value to be an array');
      const [_callback, value] = v;
      return value;
    };
    const fnTryHandler: EvalFunction = async (cs, v) => {
      assert(Array.isArray(v), 'expected value to be an array');
      const [callback, value] = v;
      assert(typeof callback === 'function', 'expected callback');
      const result = await callback(cs, value);
      return createOk(result);
    };
    const returnAtom = atom('return');
    const handlers = createRecord({
      [returnAtom]: createHandler(returnHandler),
      [FnTryEffect]: createHandler(fnTryHandler),
    });
    const selfAtom = atom('self');
    return async (evalContext) => {
      const _context = forkContext(evalContext);
      const self: EvalFunction = async (cs, arg) => {
        const [position, _, callerCompileContext] = cs;
        const fileId = callerCompileContext.fileId;
        await eventLoopYield();

        const result = await compiledPattern(arg, _context);
        assert(result.matched, matchError(position, fileId));

        const bound = bindContext(result.envs, _context);
        if (isTopFunction) bound.env.addReadonly(selfAtom, self);

        return await handleEffects(
          handlers,
          await compiledBody(bound),
          bodyPosition,
          bound,
          context
        );
      };
      return self;
    };
  },
  [NodeType.APPLICATION]: (ast, context) => {
    const astPosition = getPosition(ast);
    const [fnExpr, argStmt] = ast.children;
    const fnCompiled = compileExpr(fnExpr, context);
    const _argExpr =
      argStmt.type === NodeType.BLOCK
        ? fnAST(implicitPlaceholder(getPosition(argStmt)), argStmt, {
            isTopFunction: false,
          })
        : argStmt;
    const argCompiled = compileStatement(_argExpr, context);

    const invalidApplicationError = SystemError.invalidApplicationExpression(
      getPosition(fnExpr)
    ).withFileId(context.fileId);

    return async (evalContext) => {
      const fnValue = await fnCompiled(evalContext);
      return await flatMapEffect(
        fnValue,
        evalContext,
        async (fnValue, evalContext) => {
          assert(typeof fnValue === 'function', invalidApplicationError);

          const argValue = await argCompiled(evalContext);
          return await flatMapEffect(
            argValue,
            evalContext,
            async (argValue, evalContext) => {
              const x = await fnValue(
                [astPosition, evalContext, context],
                argValue
              );

              return await replaceEffectContext(x, evalContext);
            }
          );
        }
      );
    };
  },

  [NodeType.TRY]: (ast, context) => {
    const compiled = compileExpr(ast.children[0], context);
    const returnAtom = atom('return');
    const errorAtom = atom('error');
    const okAtom = atom('ok');
    return async (context) => {
      const result = await compiled(context);
      return await flatMapEffect(result, context, async (result, context) => {
        if (isResult(result)) {
          const [status, value] = result.value;

          if (status === okAtom) {
            return createEffect(FnTryEffect, value, context.env);
          }

          if (status === errorAtom) {
            return createEffect(returnAtom, result, context.env);
          }
        }

        return createEffect(FnTryEffect, result, context.env);
      });
    };
  },
} satisfies Record<PropertyKey, Compiler>;

const tupleOperators = {
  [NodeType.SPREAD]: (head, context) => {
    const compiled = compileExpr(head.children[0], context);
    return async (_tuple, context) => {
      const v = await compiled(context);
      return await flatMapEffect(v, context, async (v, _context) => {
        if (Array.isArray(_tuple) && Array.isArray(v)) {
          return [..._tuple, ...v];
        }
        if (isRecord(_tuple) && isRecord(v)) {
          return recordMerge(_tuple, v);
        }
        unreachable('inconsistent spread types');
      });
    };
  },
  [NodeType.LABEL]: (head, context) => {
    const _key = head.children[0];
    const compiledKey =
      _key.type === NodeType.NAME
        ? async () => atom(_key.data.value)
        : _key.type === NodeType.SQUARE_BRACKETS
        ? compileExpr(_key.children[0], context)
        : compileExpr(_key, context);
    const compiledValue = compileExpr(head.children[1], context);

    return async (_tuple, context) => {
      const key = await compiledKey(context);
      return await flatMapEffect(key, context, async (key, context) => {
        const v = await compiledValue(context);
        return await flatMapEffect(v, context, async (value, _context) => {
          if (Array.isArray(_tuple) && _tuple.length === 0)
            return createRecord([[key, value]]);
          assert(isRecord(_tuple), 'expected record');
          recordSet(_tuple, key, value);
          return _tuple;
        });
      });
    };
  },
  [NodeType.TUPLE]: (head, context) => {
    const compiled = compileExpr(head, context);
    return async (_tuple, context) => {
      const v = await compiled(context);
      assert(Array.isArray(_tuple), 'expected array');
      return await flatMapEffect(v, context, async (v, _context) => [
        ..._tuple,
        v,
      ]);
    };
  },
} satisfies Record<
  PropertyKey,
  (
    ast: Tree,
    context: CompileContext
  ) => (
    _tuple: EvalValue[] | EvalRecord,
    context: EvalContext
  ) => Promise<EvalValue>
>;

export const handleEffects = async (
  handlers: EvalRecord,
  value: EvalValue,
  position: Position,
  context: EvalContext,
  compileContext: CompileContext
): Promise<EvalValue> => {
  const cs: CallSite = [position, context, compileContext];

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
      return await handleEffects(
        handlers,
        value,
        position,
        context,
        compileContext
      );
    });
  }

  if (!recordHas(handlers, value.effect)) {
    return await mapEffect(value, context, async (value, context) => {
      return await handleEffects(
        handlers,
        value,
        position,
        context,
        compileContext
      );
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
    const result = await handleEffects(
      handlers,
      __value,
      position,
      context,
      compileContext
    );
    return result;
  };

  const handlerValue = recordGet(handlers, value.effect);
  if (!isHandler(handlerValue)) return await callback(cs, handlerValue);

  const { handler } = handlerValue;
  return await handler(
    [position, context, compileContext],
    [callback, value.value]
  );
};

const replaceEffectContext = async (
  value: EvalValue,
  context: EvalContext
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
  context: EvalContext,
  map: (v: EvalValue, context: EvalContext) => Promise<EvalValue>
): Promise<EvalValue> => {
  if (isEffect(value)) {
    value.continuations.push(async (cs, v) => map(v, context));
    return value;
  }
  return await map(value, context);
};

const flatMapEffect = async (
  value: EvalValue,
  context: EvalContext,
  map: (v: EvalValue, context: EvalContext) => Promise<EvalValue>
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

export const compileStatement: Compiler = (ast, context) => {
  if (ast.type in lazyOperators) {
    const opCompiler = lazyOperators[ast.type as keyof typeof lazyOperators];
    const compiled = opCompiler(ast, context);
    return async (context) => {
      const v = await compiled(context);
      if (v instanceof Error) throw v;
      return v;
    };
  }

  if (ast.type in operators) {
    const children = ast.children.slice();
    const fst = children.pop()!;

    const fstCompiled = compileExpr(fst, context);

    if (children.length === 0) {
      return async (context) =>
        await flatMapEffect(
          await fstCompiled(context),
          context,
          async (fstValue) => operators[ast.type](fstValue)
        );
    }

    if (children.length === 1) {
      const snd = children.pop()!;
      const sndCompiled = compileExpr(snd, context);
      return async (context) =>
        await flatMapEffect(
          await fstCompiled(context),
          context,
          async (fstValue, context) => {
            return await flatMapEffect(
              await sndCompiled(context),
              context,
              async (sndValue) => operators[ast.type](sndValue, fstValue)
            );
          }
        );
    }

    const restAst = node(ast.type, { children });
    const restCompiled = compileExpr(restAst, context);
    return async (context) =>
      await flatMapEffect(
        await fstCompiled(context),
        context,
        async (fstValue, context) => {
          const restValue = await restCompiled(context);
          return await flatMapEffect(restValue, context, async (restValue) =>
            operators[ast.type](restValue, fstValue)
          );
        }
      );
  }

  switch (ast.type) {
    case NodeType.ATOM: {
      const _atom = atom(ast.data.name);
      return async () => _atom;
    }

    case NodeType.NAME: {
      const name = ast.data.value;
      if (name === 'true') return async () => true;
      if (name === 'false') return async () => false;
      const e = SystemError.undeclaredName(name, getPosition(ast)).withFileId(
        context.fileId
      );
      const nameAtom = atom(name);
      return async (evalContext) => {
        assert(evalContext.env.has(nameAtom), e);
        return evalContext.env.get(nameAtom);
      };
    }
    case NodeType.NUMBER:
    case NodeType.STRING:
      return async () => ast.data.value;
    case NodeType.PLACEHOLDER:
      return async () => null;
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
      return async () => null;
  }
};

const compileBlock: Compiler = (ast, context) => {
  const compiled = compileStatement(ast, context);
  return async (context: EvalContext) => {
    const _context = forkContext(context);
    return await compiled(_context);
  };
};

export const compileExpr: Compiler = (ast, context) => {
  const compiled = compileStatement(ast, context);
  const e = SystemError.evaluationError(
    'expected a value',
    [],
    getPosition(ast)
  ).withFileId(context.fileId);

  return async (context) => {
    const result = await compiled(context);
    return (await flatMapEffect(result, context, async (result) => {
      assert(result !== null, e);
      return result;
    })) as Exclude<EvalValue, null>;
  };
};

export const compileScript: Compiler = (ast, context) => {
  assert(ast.type === NodeType.SCRIPT, 'expected script');
  const compiled = compileStatement(sequence(ast.children), context);
  return async (evalContext) => {
    return handleEffects(
      preludeHandlers,
      await compiled(evalContext),
      getPosition(ast),
      evalContext,
      context
    );
  };
};

const compileModule = (
  ast: Tree,
  context: CompileContext
): ((context: EvalContext) => Promise<EvalRecord>) => {
  assert(ast.type === NodeType.MODULE, 'expected module');
  const compiledBindExport = bindExport(context);
  const _compileStatement = (ast: Tree) => compileStatement(ast, context);
  const defaultExportError = (position: Position) =>
    SystemError.duplicateDefaultExport(position).withFileId(context.fileId);
  const _compileExpr = (ast: Tree) => compileExpr(ast, context);
  const _compilePattern = (ast: Tree) => compilePattern(ast, context);

  return async (context) => {
    const record: EvalRecord = createRecord();

    for (const child of ast.children) {
      if (child.type === NodeType.DECLARE) {
        const [pattern, expr] = child.children;
        const value = await _compileExpr(expr)(context);
        const { matched, envs } = await _compilePattern(pattern)(
          value,
          context
        );
        assert(matched, 'expected pattern to match');
        compiledBindExport(envs, record, context);
      } else if (child.type === NodeType.EXPORT) {
        const value = await _compileExpr(child.children[0])(context);

        assert(
          !recordHas(record, ModuleDefault),
          defaultExportError(getPosition(child.children[0]))
        );

        recordSet(record, ModuleDefault, value);
      } else {
        await _compileStatement(child)(context);
      }
    }

    return record;
  };
};

export const compileScriptString = (
  input: string,
  context: CompileContext
): Executable => {
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);
  const [errors, validated] = validate(ast, context.fileId);
  if (errors.length > 0) {
    errors.forEach((e) => e.print());
    return async () => null;
  }
  const compiled = compileScript(validated, context);

  return async (evalContext) => {
    return await compiled(evalContext).catch((e) => {
      if (e instanceof SystemError) e.print();

      return null;
    });
  };
};

export const evaluateModuleString = async (
  input: string,
  context: CompileContext,
  evalContext: EvalContext
): Promise<EvalRecord> => {
  return await compileModuleString(input, context)(evalContext);
};

const compileModuleString = (
  input: string,
  context: CompileContext
): ((context: EvalContext) => Promise<EvalRecord>) => {
  const tokens = parseTokens(input);
  const ast = parseModule(tokens);
  const [errors, validated] = validate(ast, context.fileId);

  if (errors.length > 0) {
    errors.forEach((e) => e.print());
    return async () => createRecord();
  }

  const compiled = compileModule(validated, context);
  return async (context) => {
    return await compiled(context).catch((e) => {
      if (e instanceof SystemError) e.print();

      return createRecord();
    });
  };
};

export const evaluateEntryFile = async (file: string, argv: string[] = []) => {
  return await compileEntryFile(file)(argv);
};

const compileEntryFile = (file: string) => {
  const resolved = path.resolve(file);
  const root = path.dirname(resolved);
  const name = '/' + path.basename(resolved);
  register(Injectable.RootDir, root);
  return async (argv: string[] = []) => {
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
        [{ start: 0, end: 0 }, newContext(), newCompileContext(fileId, file)],
        argv
      );
      return value;
    }

    unreachable('file must be a script or a module');
  };
};
