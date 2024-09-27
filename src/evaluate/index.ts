import { Diagnostic, primaryDiagnosticLabel } from 'codespan-napi';
import { SystemError } from '../error.js';
import {
  getModule,
  listMethods,
  ModuleDefault,
  prelude,
  preludeHandlers,
  ReturnHandler,
  stringMethods,
} from '../files.js';
import { getPosition, parseModule, parseScript } from '../parser.js';
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
  ExpressionNode,
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
  createRecord,
  createTask,
  EvalFunction,
  EvalRecord,
  EvalValue,
  fn,
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
import {
  Handlers,
  maskHandlers,
  newHandlers,
  withoutHandlers,
  Environment,
  newEnvironment,
  environmentHas,
  environmentKeys,
  environmentGet,
  environmentSet,
  environmentAdd,
} from '../environment.js';
import { Position } from '../position.js';
import {
  bind,
  bindContext,
  PatternTestEnvs,
  testPattern,
} from './patternMatching.js';

export type Context = {
  file: string;
  fileId: number;
  readonly: Environment;
  env: Environment;
  handlers: Handlers;
};

export const forkContext = (context: Context): Context => {
  return {
    ...context,
    env: newEnvironment({}, context.env),
    readonly: newEnvironment({}, context.readonly),
  };
};

export const newContext = (fileId: number, file: string): Context => {
  return {
    file,
    fileId,
    env: newEnvironment(),
    readonly: newEnvironment({}, prelude),
    handlers: newHandlers({}, preludeHandlers),
  };
};

const showNode = (node: Tree, context: Context, msg: string = '') => {
  const position = getPosition(node);
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

const incAssign = (
  envs: PatternTestEnvs,
  context: Context,
  position: Position
) => {
  assert(envs.exports.size === 0, 'cant do exports at increment');
  assert(envs.env.size === 0, 'cant do mutable declarations at increment');

  // inspect({
  //   tag: 'assign',
  //   matched,
  //   envs,
  //   context,
  // });

  for (const [patternKey, value] of envs.readonly.entries()) {
    if (typeof patternKey === 'string') {
      assert(
        !environmentHas(context.readonly, patternKey),

        SystemError.immutableVariableAssignment(
          patternKey,
          position
        ).withFileId(context.fileId)
      );
      assert(
        environmentHas(context.env, patternKey),
        SystemError.invalidAssignment(
          patternKey,
          position,
          getClosestName(
            patternKey,
            environmentKeys(context.env).filter((k) => typeof k === 'string')
          )
        ).withFileId(context.fileId)
      );

      const v = environmentGet(context.env, patternKey);
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
      environmentSet(context.env, patternKey, v + value);
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

  // inspect({
  //   tag: 'assign 2',
  //   matched,
  //   envs,
  //   context,
  // });
};

const assign = (
  envs: PatternTestEnvs,
  context: Context,
  position: Position
) => {
  assert(envs.exports.size === 0, 'cant do exports in at assignment');
  assert(envs.env.size === 0, 'cant do mutable declarations at assignment');

  // inspect({
  //   tag: 'assign 2',
  //   matched,
  //   envs,
  //   context,
  // });

  for (const [patternKey, value] of envs.readonly.entries()) {
    if (typeof patternKey === 'string') {
      assert(
        !environmentHas(context.readonly, patternKey),
        SystemError.immutableVariableAssignment(
          patternKey,
          position
        ).withFileId(context.fileId)
      );
      assert(
        environmentSet(context.env, patternKey, value),
        SystemError.invalidAssignment(
          patternKey,
          position,
          getClosestName(
            patternKey,
            environmentKeys(context.env).filter((k) => typeof k === 'string')
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

  // inspect({
  //   tag: 'assign 3',
  //   matched,
  //   envs,
  //   context,
  // });
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
      !context.readonly.entries.has(key),
      'cannot declare name inside module more than once'
    );
    assert(
      !context.env.entries.has(key),
      'cannot declare name inside module more than once'
    );
    environmentAdd(context.readonly, key, value);
  }

  for (const [key, value] of envs.env.entries()) {
    assert(typeof key === 'string', 'can only declare names');

    if (value === null) continue;
    assert(
      !context.readonly.entries.has(key),
      'cannot declare name inside module more than once'
    );
    assert(
      !context.env.entries.has(key),
      'cannot declare name inside module more than once'
    );
    environmentAdd(context.env, key, value);
  }

  for (const [key, value] of envs.exports.entries()) {
    assert(typeof key === 'string', 'can only declare names');
    assert(
      !context.readonly.entries.has(key),
      'cannot declare name inside module more than once'
    );
    assert(
      !context.env.entries.has(key),
      'cannot declare name inside module more than once'
    );

    if (value === null) continue;
    environmentAdd(context.readonly, key, value);
    recordSet(exports, key, value);
  }
}

const operators = {
  [NodeType.ADD]: (head: EvalValue, ...rest: EvalValue[]) => {
    let sum = head;
    assert(
      typeof sum === 'number' || typeof sum === 'string' || isChannel(sum),
      'expected number, channel or string on lhs'
    );
    for (const v of rest) {
      assert(
        typeof v === typeof sum,
        'expected both lhs and rhs have the same type'
      );
      if (isChannel(v)) {
        assert(isChannel(sum));
        const c = createChannel('select');
        Promise.race([receive(v), receive(sum)]).then((v) => send(c, v));
        sum = c;
      } else sum = (sum as string) + (v as string);
    }
    return sum;
  },
  [NodeType.SUB]: (head: EvalValue, ...rest: EvalValue[]) => {
    assert(typeof head === 'number', 'expected number');
    let sum = head;
    for (const v of rest) {
      assert(typeof v === 'number', 'expected number');
      sum -= v;
    }
    return sum;
  },
  [NodeType.MULT]: (head: EvalValue, ...rest: EvalValue[]) => {
    assert(typeof head === 'number', 'expected number');
    let sum = head;
    for (const v of rest) {
      assert(typeof v === 'number', 'expected number');
      sum *= v;
    }
    return sum;
  },
  [NodeType.DIV]: (head: EvalValue, ...rest: EvalValue[]) => {
    assert(typeof head === 'number', 'expected number');
    let sum = head;
    for (const v of rest) {
      assert(typeof v === 'number', 'expected number');
      sum /= v;
    }
    return sum;
  },
  [NodeType.MOD]: (head: EvalValue, ...rest: EvalValue[]) => {
    assert(typeof head === 'number', 'expected number');
    let sum = head;
    for (const v of rest) {
      assert(typeof v === 'number', 'expected number');
      sum %= v;
    }
    return sum;
  },
  [NodeType.POW]: (head: EvalValue, ...rest: EvalValue[]) => {
    assert(typeof head === 'number', 'expected number');
    let sum = head;
    for (const v of rest) {
      assert(typeof v === 'number', 'expected number');
      sum **= v;
    }
    return sum;
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

const lazyOperators = {
  [NodeType.FORK]: async ([expr]: Tree[], context: Context) => {
    return createTask(
      async () => await evaluateBlock(expr, context),
      (e) => {
        console.error(e);
        if (e instanceof SystemError) e.print();
        else showNode(expr, context, e.message);
      }
    );
  },
  [NodeType.PARALLEL]: (args: Tree[], context: Context) => {
    const tasks = args.map((arg) =>
      lazyOperators[NodeType.FORK]([arg], context)
    );
    return Promise.all(tasks);
  },
  [NodeType.AND]: async ([head, ...rest]: Tree[], context: Context) => {
    const restAst =
      rest.length > 1 ? node(NodeType.AND, { children: rest }) : rest[0];
    return await lazyOperators[NodeType.IF_ELSE](
      [head, restAst, nameAST('false', getPosition(head))],
      context
    );
  },
  [NodeType.OR]: async ([head, ...rest]: Tree[], context: Context) => {
    const restAst =
      rest.length > 1 ? node(NodeType.OR, { children: rest }) : rest[0];
    return await lazyOperators[NodeType.IF_ELSE](
      [head, nameAST('true', getPosition(head)), restAst],
      context
    );
  },

  [NodeType.PARENS]: async ([arg]: Tree[], context: Context) => {
    if (arg.type === NodeType.IMPLICIT_PLACEHOLDER) return [];
    return await evaluateStatement(arg, context);
  },
  [NodeType.SQUARE_BRACKETS]: async ([arg]: Tree[], context: Context) => {
    if (arg.type === NodeType.IMPLICIT_PLACEHOLDER) return [];
    return await evaluateStatement(arg, context);
  },

  [NodeType.INJECT]: async ([expr, body]: Tree[], context: Context) => {
    const value = await evaluateExpr(expr, context);
    assert(isRecord(value), 'expected record');

    const handlers = newHandlers(value, context.handlers);
    const result = await evaluateBlock(body, { ...context, handlers });

    return await evaluateHandlers(value, result, getPosition(body), context);
  },
  [NodeType.WITHOUT]: async ([expr, body]: Tree[], context: Context) => {
    let value = await evaluateExpr(expr, context);
    if (!Array.isArray(value)) value = [value];

    const handlers = withoutHandlers(context.handlers, value);
    return await evaluateBlock(body, { ...context, handlers });
  },
  [NodeType.MASK]: async ([expr, body]: Tree[], context: Context) => {
    let value = await evaluateExpr(expr, context);
    if (!Array.isArray(value)) value = [value];

    const handlers = maskHandlers(context.handlers, value);
    return await evaluateBlock(body, { ...context, handlers });
  },

  [NodeType.IS]: async ([value, pattern]: Tree[], context: Context) => {
    const v = await evaluateStatement(value, context);
    const result = await testPattern(pattern, v, context);
    // inspect({
    //   tag: 'evaluateExpr is',
    //   result,
    // });
    return result.matched;
  },
  [NodeType.MATCH]: async ([expr, ...branches]: Tree[], context: Context) => {
    const value = await evaluateExpr(expr, context);

    for (const branch of branches) {
      assert(branch.type === NodeType.MATCH_CASE, 'expected match case');
      const [pattern, body] = branch.children;

      const result = await testPattern(pattern, value, context);
      if (result.matched) {
        return await evaluateBlock(body, bindContext(result.envs, context));
      }
    }

    return null;
  },
  [NodeType.IF]: async ([condition, branch]: Tree[], context: Context) => {
    const falseBranch = placeholder(getPosition(branch));
    return await lazyOperators[NodeType.IF_ELSE](
      [condition, branch, falseBranch],
      context
    );
  },
  [NodeType.IF_ELSE]: async (
    [condition, trueBranch, falseBranch]: Tree[],
    context: Context
  ) => {
    // inspect({
    //   tag: 'evaluateExpr if else 1',
    //   condition,
    //   context,
    // });
    if (condition.type === NodeType.IS) {
      const [value, pattern] = condition.children;
      const v = await evaluateStatement(value, context);
      const result = await testPattern(pattern, v, context);
      // inspect({
      //   tag: 'evaluateExpr if else 2',
      //   result,
      //   condition,
      //   context,
      // });

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
    }

    const result = await evaluateExpr(condition, context);
    // inspect({
    //   tag: 'evaluateExpr if else 3',
    //   result,
    //   condition,
    //   context,
    // });
    if (result) return await evaluateBlock(trueBranch, context);
    else return await evaluateBlock(falseBranch, context);
  },
  [NodeType.WHILE]: async ([condition, body]: Tree[], context: Context) => {
    const _break = application(
      nameAST('break', getPosition(condition)),
      placeholder(getPosition(condition))
    );
    return await lazyOperators[NodeType.LOOP](
      [ifElse(condition, body, _break)],
      context
    );
  },
  [NodeType.FOR]: async ([pattern, expr, body]: Tree[], context: Context) => {
    const list = await evaluateExpr(expr, context);

    assert(
      Array.isArray(list),
      SystemError.evaluationError(
        'for loop iterates over lists only.',
        [],
        getPosition(expr)
      )
    );
    const blockBreak = fn(1, async (cs, value) => {
      throw { break: value };
    });
    const blockContinue = fn(1, async (cs, value) => {
      await eventLoopYield();
      throw { continue: value };
    });

    const forked = forkContext(context);
    environmentAdd(forked.readonly, 'break', blockBreak);
    environmentAdd(forked.readonly, 'continue', blockContinue);

    const mapped: EvalValue[] = [];
    for (const item of list) {
      try {
        const result = await testPattern(pattern, item, forked);
        assert(result.matched, 'expected pattern to match');
        const bound = bindContext(result.envs, forked);
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
  },
  [NodeType.LOOP]: async ([body]: Tree[], context: Context) => {
    if (body.type === NodeType.BLOCK) {
      body = body.children[0];
    }
    const _continue = application(
      nameAST('continue', getPosition(body)),
      placeholder(getPosition(body))
    );
    return await lazyOperators[NodeType.BLOCK](
      [sequence([body, _continue] as ExpressionNode[])],
      context
    );
  },

  [NodeType.BLOCK]: async ([expr]: Tree[], context: Context) => {
    const blockBreak = fn(1, async (cs, value) => {
      throw { break: value };
    });
    const blockContinue = fn(1, async (cs, value) => {
      await eventLoopYield();
      throw { continue: value };
    });

    const forked = forkContext(context);
    environmentAdd(forked.readonly, 'break', blockBreak);
    environmentAdd(forked.readonly, 'continue', blockContinue);
    try {
      return await evaluateBlock(expr, forked);
    } catch (e) {
      if (typeof e !== 'object' || e === null) throw e;
      if ('label' in e) throw e;
      if ('break' in e) {
        const value = e.break as EvalValue;
        return value;
      } else if ('continue' in e) {
        return await lazyOperators[NodeType.BLOCK]([expr], context);
      } else throw e;
    }
  },
  [NodeType.SEQUENCE]: async ([expr, ...rest]: Tree[], context: Context) => {
    if (rest.length === 0) return await evaluateStatement(expr, context);
    return await evaluateStatementEffect(
      expr,
      context,
      async () => await lazyOperators[NodeType.SEQUENCE](rest, context)
    );
  },

  [NodeType.INCREMENT]: async ([arg]: Tree[], context: Context) => {
    assert(arg.type === NodeType.NAME, 'expected name');
    const value = await evaluateExpr(arg, context);
    assert(typeof value === 'number', 'expected number');
    const { matched, envs } = await testPattern(arg, value + 1, context);
    assert(matched, 'expected pattern to match');
    assign(envs, context, getPosition(arg));
    return value + 1;
  },
  [NodeType.DECREMENT]: async ([arg]: Tree[], context: Context) => {
    assert(arg.type === NodeType.NAME, 'expected name');
    const value = await evaluateExpr(arg, context);
    assert(typeof value === 'number', 'expected number');
    const { matched, envs } = await testPattern(arg, value - 1, context);
    assert(matched, 'expected pattern to match');
    assign(envs, context, getPosition(arg));
    return value - 1;
  },
  [NodeType.POST_DECREMENT]: async ([arg]: Tree[], context: Context) => {
    assert(arg.type === NodeType.NAME, 'expected name');
    const value = await evaluateExpr(arg, context);
    assert(typeof value === 'number', 'expected number');
    const { matched, envs } = await testPattern(arg, value - 1, context);
    assert(matched, 'expected pattern to match');
    assign(envs, context, getPosition(arg));
    return value;
  },
  [NodeType.POST_INCREMENT]: async ([arg]: Tree[], context: Context) => {
    assert(arg.type === NodeType.NAME, 'expected name');
    const value = await evaluateExpr(arg, context);
    assert(typeof value === 'number', 'expected number');
    const { matched, envs } = await testPattern(arg, value + 1, context);
    assert(matched, 'expected pattern to match');
    assign(envs, context, getPosition(arg));
    return value;
  },

  [NodeType.DECLARE]: async ([pattern, expr]: Tree[], context: Context) => {
    const value = await evaluateStatement(expr, context);
    // inspect({
    //   tag: 'evaluateExpr declare',
    //   value,
    //   context,
    // });
    const result = await testPattern(pattern, value, context);
    assert(result.matched, 'expected pattern to match');
    bind(result.envs, context);
    return value;
  },
  [NodeType.ASSIGN]: async ([pattern, expr]: Tree[], context: Context) => {
    const value = await evaluateStatement(expr, context);
    const { matched, envs } = await testPattern(pattern, value, context);
    assert(matched, 'expected pattern to match');
    assign(envs, context, getPosition(pattern));
    return value;
  },
  [NodeType.INC_ASSIGN]: async ([pattern, expr]: Tree[], context: Context) => {
    const value = await evaluateExpr(expr, context);
    assert(typeof value === 'number' || Array.isArray(value));
    const { matched, envs } = await testPattern(pattern, value, context);
    assert(matched, 'expected pattern to match');
    incAssign(envs, context, getPosition(pattern));
    return value;
  },

  [NodeType.LABEL]: async ([_key, expr]: Tree[], context: Context) => {
    const value = await evaluateExpr(expr, context);
    const key =
      _key.type === NodeType.NAME
        ? _key.data.value
        : await evaluateExpr(_key, context);

    return createRecord({ [key]: value });
  },
  [NodeType.TUPLE]: async (children: Tree[], context: Context) => {
    if (children.length === 0) return [];
    const [head, ...tail] = children;
    if (head.type === NodeType.IMPLICIT_PLACEHOLDER) return [];
    if (head.type === NodeType.PLACEHOLDER) return [];
    if (head.type === NodeType.SPREAD) {
      return await evaluateExprEffect(head.children[0], context, async (v) => {
        const _tail = await lazyOperators[NodeType.TUPLE](tail, context);
        return mapEffect(_tail, async (_tail) => {
          if (Array.isArray(_tail) && Array.isArray(v)) {
            return [...v, ..._tail];
          }
          if (isRecord(_tail) && isRecord(v)) {
            return recordMerge(v, _tail);
          }
          unreachable('inconsistent spread types');
        });
      });
    }
    if (head.type === NodeType.LABEL) {
      const _key = head.children[0];
      if (_key.type === NodeType.NAME) {
        const key = _key.data.value;
        return await evaluateExprEffect(
          head.children[1],
          context,
          async (value) => {
            const _tail = await lazyOperators[NodeType.TUPLE](tail, context);
            return mapEffect(_tail, async (_tail) => {
              if (Array.isArray(_tail) && _tail.length === 0)
                return createRecord([[key, value]]);
              assert(isRecord(_tail), 'expected record');
              recordSet(_tail, key, value);
              return _tail;
            });
          }
        );
      }
      return await evaluateExprEffect(_key, context, async (key) => {
        return await evaluateExprEffect(
          head.children[1],
          context,
          async (value) => {
            const _tail = await lazyOperators[NodeType.TUPLE](tail, context);
            return mapEffect(_tail, async (_tail) => {
              if (Array.isArray(_tail) && _tail.length === 0)
                return createRecord([[key, value]]);
              assert(isRecord(_tail), 'expected record');
              recordSet(_tail, key, value);
              return _tail;
            });
          }
        );
      });
    }
    return await evaluateExprEffect(head, context, async (v) => {
      const _tail = await lazyOperators[NodeType.TUPLE](tail, context);
      return mapEffect(_tail, async (_tail) => {
        assert(Array.isArray(_tail), 'expected array');
        return [v, ..._tail];
      });
    });
  },
  [NodeType.INDEX]: async ([_target, _index]: Tree[], context: Context) => {
    const target = await evaluateExpr(_target, context);
    const index = await evaluateExpr(_index, context);

    if (Array.isArray(target)) {
      if (!Number.isInteger(index)) {
        assert(
          typeof index === 'string',
          SystemError.invalidIndex(getPosition(_index)).withFileId(
            context.fileId
          )
        );
        return await listMethods[index](
          [getPosition(_index), context.fileId],
          target
        );
      }
      return target[index as number] ?? null;
    } else if (isRecord(target)) {
      const v = recordGet(target, index);
      assert(
        v !== null,
        SystemError.invalidIndex(getPosition(_index)).withFileId(context.fileId)
      );
      return v;
    }

    if (typeof target === 'string') {
      assert(
        typeof index === 'string' && index in stringMethods,
        SystemError.invalidIndex(getPosition(_index)).withFileId(context.fileId)
      );
      return await stringMethods[index](
        [getPosition(_index), context.fileId],
        target
      );
    }

    unreachable(
      SystemError.invalidIndexTarget(getPosition(_index)).withFileId(
        context.fileId
      )
    );
  },

  [NodeType.PIPE]: async ([arg, ...fns]: Tree[], context: Context) => {
    let value = await evaluateStatement(arg, context);
    for (const fn of fns) {
      const fnValue = await evaluateExpr(fn, context);
      assert(typeof fnValue === 'function', 'expected function');
      value = await fnValue([getPosition(fn), context], value);
    }
    return value;
  },
  [NodeType.SEND]: async ([chanAst, valueAst]: Tree[], context: Context) => {
    const channelValue = await evaluateExpr(chanAst, context);
    const value = await evaluateExpr(valueAst, context);

    assert(
      isChannel(channelValue),
      SystemError.invalidSendChannel(getPosition(chanAst)).withFileId(
        context.fileId
      )
    );

    const channel = getChannel(channelValue);

    assert(
      channel,
      SystemError.channelClosed(getPosition(chanAst)).withFileId(context.fileId)
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
  },
};

const evaluateHandlers = async (
  handlers: EvalRecord,
  _value: EvalValue,
  position: Position,
  context: Context
): Promise<EvalValue> => {
  // inspect({
  //   tag: 'evaluateHandlers',
  //   handlers,
  //   _value,
  // });
  const cs: CallSite = [position, context];
  if (isEffect(_value)) {
    const { effect, value, continuation } = _value;
    if (recordHas(handlers, effect)) {
      const _handler = recordGet(handlers, effect);
      if (isHandler(_handler)) {
        const { handler } = _handler;
        const callback: EvalFunction = async (cs, _value) => {
          const value = await continuation(cs, _value);
          return await evaluateHandlers(handlers, value, position, context);
        };
        return await handler([position, context], [callback, value]);
      }

      const __value = await continuation(cs, _handler);
      return await evaluateHandlers(handlers, __value, position, context);
    }
    return createEffect(effect, value, async (cs, _value) => {
      const value = await continuation(cs, _value);
      return await evaluateHandlers(handlers, value, position, context);
    });
  }
  const returnHandler = recordGet(handlers, ReturnHandler);
  if (returnHandler === null) return _value;
  assert(
    typeof returnHandler === 'function',
    'expected return handler to be a function'
  );
  return returnHandler(cs, _value);
};

const mapEffect = async (
  value: EvalValue,
  map: (v: EvalValue) => Promise<EvalValue>
): Promise<EvalValue> => {
  if (isEffect(value)) {
    const { effect, value: v, continuation: c } = value;
    const nextCont: EvalFunction = async (cs, v) => {
      return await c(cs, v).then(map);
    };
    return createEffect(effect, v, nextCont);
  }
  return map(value);
};

const evaluateStatementEffect = async (
  ast: Tree,
  context: Context,
  map: (v: EvalValue) => Promise<EvalValue>
): Promise<EvalValue> => {
  return await mapEffect(await evaluateStatement(ast, context), map);
};

const evaluateExprEffect = async (
  ast: Tree,
  context: Context,
  map: (v: EvalValue) => Promise<EvalValue>
): Promise<EvalValue> => {
  return await mapEffect(await evaluateExpr(ast, context), map);
};

const evaluateStatement = async (
  ast: Tree,
  context: Context
): Promise<EvalValue> => {
  if (ast.type in lazyOperators) {
    return await lazyOperators[ast.type](ast.children, context);
  }

  if (ast.type in operators) {
    const args: EvalValue[] = [];
    for (const child of ast.children) {
      args.push(await evaluateExpr(child, context));
    }
    return operators[ast.type](...args);
  }

  switch (ast.type) {
    case NodeType.IMPORT: {
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
    }

    case NodeType.CODE_LABEL: {
      const expr = ast.children[0];
      const labelBreak = fn(1, async (cs, value) => {
        throw { break: value, label: ast.data.name };
      });
      const labelContinue = fn(1, async (cs, value) => {
        await eventLoopYield();
        throw { continue: value, label: ast.data.name };
      });

      const forked = forkContext(context);
      environmentAdd(
        forked.readonly,
        ast.data.name,
        createRecord({
          break: labelBreak,
          continue: labelContinue,
        })
      );
      try {
        return await evaluateStatement(expr, forked);
      } catch (e) {
        if (typeof e !== 'object' || e === null) throw e;
        if (!('label' in e && e.label === ast.data.name)) throw e;
        if ('break' in e) {
          const value = e.break as EvalValue;
          return value;
        } else if ('continue' in e) {
          return await evaluateStatement(ast, context);
        } else throw e;
      }
    }

    case NodeType.RECEIVE: {
      const channelValue = await evaluateExpr(ast.children[0], context);

      assert(
        isChannel(channelValue),
        SystemError.invalidReceiveChannel(getPosition(ast)).withFileId(
          context.fileId
        )
      );

      return receive(channelValue).catch((e) => {
        assert(
          e !== 'channel closed',
          SystemError.channelClosed(getPosition(ast)).withFileId(context.fileId)
        );
        throw e;
      });
    }
    case NodeType.SEND_STATUS: {
      const [channelValue, value] = [
        await evaluateExpr(ast.children[0], context),
        await evaluateExpr(ast.children[1], context),
      ];

      assert(
        isChannel(channelValue),
        SystemError.invalidSendChannel(getPosition(ast)).withFileId(
          context.fileId
        )
      );

      const status = send(channelValue, value);
      return atom(status);
    }
    case NodeType.RECEIVE_STATUS: {
      const channelValue = await evaluateExpr(ast.children[0], context);

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

    case NodeType.FUNCTION: {
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
          environmentAdd(bound.readonly, 'self', self);
          bound.handlers = callerContext.handlers;
        }

        // inspect({
        //   tag: 'evaluateExpr function',
        //   bound,
        //   __context,
        //   _context,
        //   context,
        //   callerContext,
        // });

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
    case NodeType.APPLICATION: {
      const [fnExpr, argStmt] = ast.children;
      const [fnValue, argValue] = [
        await evaluateExpr(fnExpr, context),
        await evaluateStatement(argStmt, context),
      ];

      assert(
        typeof fnValue === 'function',
        SystemError.invalidApplicationExpression(
          getPosition(fnExpr)
        ).withFileId(context.fileId)
      );

      const x = await fnValue([getPosition(ast), context], argValue);
      // inspect({ x });
      return x;
    }

    case NodeType.ATOM: {
      return atom(ast.data.name);
    }

    case NodeType.NAME: {
      const name = ast.data.value;
      if (name === 'true') return true;
      if (name === 'false') return false;
      if (name === 'injected') return context.handlers.resolve();
      // inspect({
      //   tag: 'evaluateExpr name',
      //   name,
      //   // env: context.env,
      //   readonly: context.readonly,
      // });
      assert(
        environmentHas(context.env, name) ||
          environmentHas(context.readonly, name),
        SystemError.undeclaredName(name, getPosition(ast)).withFileId(
          context.fileId
        )
      );
      return (
        environmentGet(context.readonly, name) ??
        environmentGet(context.env, name)
      );
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
  // inspect({
  //   tag: 'evaluateExpr',
  //   result,
  //   ast,
  //   context,
  // });
  assert(
    result !== null,
    SystemError.evaluationError(
      'expected a value',
      [],
      getPosition(ast)
    ).withFileId(context.fileId)
  );
  return result;
};

export const evaluateScript = async (
  ast: Tree,
  context: Context
): Promise<EvalValue> => {
  assert(ast.type === NodeType.SCRIPT, 'expected script');
  return await lazyOperators[NodeType.SEQUENCE](ast.children, context);
};

export const evaluateModule = async (
  ast: Tree,
  context: Context
): Promise<EvalRecord> => {
  assert(ast.type === NodeType.MODULE, 'expected module');
  const record: EvalRecord = createRecord();

  // inspect({
  //   tag: 'evaluateModule',
  //   ast,
  //   // context,
  // });

  for (const child of ast.children) {
    if (child.type === NodeType.DECLARE) {
      const [pattern, expr] = child.children;
      const value = await evaluateExpr(expr, context);
      const { matched, envs } = await testPattern(pattern, value, context);
      // inspect({
      //   tag: 'evaluateModule declare',
      //   result,
      // });
      assert(matched, 'expected pattern to match');
      bindExport(envs, record, context);
      // inspect({
      //   tag: 'evaluateModule declare',
      //   envs,
      //   context,
      //   record,
      // });
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
