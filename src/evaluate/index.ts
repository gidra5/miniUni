import { Diagnostic, primaryDiagnosticLabel } from 'codespan-napi';
import { SystemError } from '../error.js';
import { getModule } from '../files.js';
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
  loop,
  block,
  tuple,
} from '../ast.js';
import { parseTokens } from '../tokens.js';
import {
  assert,
  eventLoopYield,
  getClosestName,
  inspect,
  isEqual,
  promisify,
  unpromisify,
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
  createTask,
  EvalFunction,
  EvalFunctionPromise,
  EvalRecord,
  EvalValue,
  fn,
  fnCont,
  fnPromise,
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
import { prelude, preludeHandlers, ReturnHandler } from '../std/prelude.js';
import { ModuleDefault } from '../module.js';
import { listMethods } from '../std/list.js';
import { stringMethods } from '../std/string.js';

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
  [NodeType.ADD]: (lhs: EvalValue, rhs: EvalValue, ...rest: EvalValue[]) => {
    assert(
      typeof lhs === 'number' || typeof lhs === 'string' || isChannel(lhs),
      'expected number, channel or string on lhs'
    );
    assert(
      typeof lhs === typeof rhs,
      'expected both lhs and rhs have the same type'
    );

    let sum = lhs;
    if (isChannel(rhs)) {
      assert(isChannel(sum));
      const c = createChannel('select');
      Promise.race([receive(rhs), receive(sum)]).then((v) => send(c, v));
      sum = c;
    } else {
      sum = (sum as string) + (rhs as string);
    }

    if (rest.length === 0) return sum;
    const _rest = rest as [EvalValue, ...EvalValue[]];
    return operators[NodeType.ADD](sum, ..._rest);
  },
  [NodeType.SUB]: (lhs: EvalValue, rhs: EvalValue, ...rest: EvalValue[]) => {
    assert(typeof lhs === 'number', 'expected number');
    assert(typeof rhs === 'number', 'expected number');

    if (rest.length === 0) return lhs - rhs;
    const _rest = rest as [EvalValue, ...EvalValue[]];
    return operators[NodeType.SUB](lhs - rhs, ..._rest);
  },
  [NodeType.MULT]: (lhs: EvalValue, rhs: EvalValue, ...rest: EvalValue[]) => {
    assert(typeof lhs === 'number', 'expected number');
    assert(typeof rhs === 'number', 'expected number');

    if (rest.length === 0) return lhs * rhs;
    const _rest = rest as [EvalValue, ...EvalValue[]];
    return operators[NodeType.MULT](lhs * rhs, ..._rest);
  },
  [NodeType.DIV]: (lhs: EvalValue, rhs: EvalValue, ...rest: EvalValue[]) => {
    assert(typeof lhs === 'number', 'expected number');
    assert(typeof rhs === 'number', 'expected number');

    if (rest.length === 0) return lhs / rhs;
    const _rest = rest as [EvalValue, ...EvalValue[]];
    return operators[NodeType.DIV](lhs / rhs, ..._rest);
  },
  [NodeType.MOD]: (lhs: EvalValue, rhs: EvalValue, ...rest: EvalValue[]) => {
    assert(typeof lhs === 'number', 'expected number');
    assert(typeof rhs === 'number', 'expected number');

    if (rest.length === 0) return lhs % rhs;
    const _rest = rest as [EvalValue, ...EvalValue[]];
    return operators[NodeType.MOD](lhs % rhs, ..._rest);
  },
  [NodeType.POW]: (lhs: EvalValue, rhs: EvalValue, ...rest: EvalValue[]) => {
    assert(typeof lhs === 'number', 'expected number');
    assert(typeof rhs === 'number', 'expected number');

    if (rest.length === 0) return lhs ** rhs;
    const _rest = rest as [EvalValue, ...EvalValue[]];
    return operators[NodeType.POW](lhs ** rhs, ..._rest);
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
  [NodeType.IMPORT]: unpromisify(async (ast: Tree, context: Context) => {
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
  }),
  [NodeType.FORK]: unpromisify(async (ast: Tree, context: Context) => {
    const [expr] = ast.children;
    return createTask(
      async () => await evaluateBlock(expr, context),
      (e) => {
        console.error(e);
        if (e instanceof SystemError) e.print();
        else showNode(expr, context, e.message);
      }
    );
  }),
  [NodeType.PARALLEL]: unpromisify(async (ast: Tree, context: Context) => {
    const tasks = ast.children.map((arg) =>
      evaluateStatement(node(NodeType.FORK, { children: [arg] }), context)
    );
    return await Promise.all(tasks);
  }),
  [NodeType.AND]: unpromisify(async (ast: Tree, context: Context) => {
    const [head, ...rest] = ast.children;
    const restAst =
      rest.length > 1 ? node(NodeType.AND, { children: rest }) : rest[0];
    const _node = ifElse(head, restAst, nameAST('false', getPosition(head)));
    return await evaluateStatement(_node, context);
  }),
  [NodeType.OR]: unpromisify(async (ast: Tree, context: Context) => {
    const [head, ...rest] = ast.children;
    const restAst =
      rest.length > 1 ? node(NodeType.OR, { children: rest }) : rest[0];
    const _node = ifElse(head, nameAST('true', getPosition(head)), restAst);
    return await evaluateStatement(_node, context);
  }),

  [NodeType.PARENS]: unpromisify(async (ast: Tree, context: Context) => {
    const [arg] = ast.children;
    if (arg.type === NodeType.IMPLICIT_PLACEHOLDER) return [];
    return await evaluateStatement(arg, context);
  }),
  [NodeType.SQUARE_BRACKETS]: unpromisify(
    async (ast: Tree, context: Context) => {
      const [arg] = ast.children;
      if (arg.type === NodeType.IMPLICIT_PLACEHOLDER) return [];
      return await evaluateStatement(arg, context);
    }
  ),

  [NodeType.INJECT]: unpromisify(async (ast: Tree, context: Context) => {
    const [expr, body] = ast.children;
    const value = await evaluateExpr(expr, context);
    assert(isRecord(value), 'expected record');

    const handlers = newHandlers(value, context.handlers);
    const result = await evaluateBlock(body, { ...context, handlers });

    return await evaluateHandlers(value, result, getPosition(body), context);
  }),
  [NodeType.WITHOUT]: unpromisify(async (ast: Tree, context: Context) => {
    const [expr, body] = ast.children;
    let value = await evaluateExpr(expr, context);
    if (!Array.isArray(value)) value = [value];

    const handlers = withoutHandlers(context.handlers, value);
    return await evaluateBlock(body, { ...context, handlers });
  }),
  [NodeType.MASK]: unpromisify(async (ast: Tree, context: Context) => {
    const [expr, body] = ast.children;
    let value = await evaluateExpr(expr, context);
    if (!Array.isArray(value)) value = [value];

    const handlers = maskHandlers(context.handlers, value);
    return await evaluateBlock(body, { ...context, handlers });
  }),

  [NodeType.IS]: unpromisify(async (ast: Tree, context: Context) => {
    const [value, pattern] = ast.children;
    const v = await evaluateStatement(value, context);
    const result = await testPattern(pattern, v, context);
    // inspect({
    //   tag: 'evaluateExpr is',
    //   result,
    // });
    return result.matched;
  }),
  [NodeType.MATCH]: unpromisify(async (ast: Tree, context: Context) => {
    const [expr, ...branches] = ast.children;
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
  }),
  [NodeType.IF]: unpromisify(async (ast: Tree, context: Context) => {
    const [condition, branch] = ast.children;
    const falseBranch = placeholder(getPosition(branch));
    const _node = ifElse(condition, branch, falseBranch);
    return await evaluateStatement(_node, context);
  }),
  [NodeType.IF_ELSE]: unpromisify(async (ast: Tree, context: Context) => {
    const [condition, trueBranch, falseBranch] = ast.children;
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
  }),
  [NodeType.WHILE]: unpromisify(async (ast: Tree, context: Context) => {
    const [condition, body] = ast.children;
    const _break = application(
      nameAST('break', getPosition(condition)),
      placeholder(getPosition(condition))
    );
    const _node = loop(ifElse(condition, body, _break));
    return await evaluateStatement(_node, context);
  }),
  [NodeType.FOR]: unpromisify(async (ast: Tree, context: Context) => {
    const [pattern, expr, body] = ast.children;
    const list = await evaluateExpr(expr, context);

    assert(
      Array.isArray(list),
      SystemError.evaluationError(
        'for loop iterates over lists only.',
        [],
        getPosition(expr)
      )
    );
    const breakHandler: EvalFunction = fn(1, async (cs, v) => {
      assert(Array.isArray(v), 'expected value to be an array');
      const [_callback, value] = v;
      return ['break', value];
    });
    const continueHandler: EvalFunction = fn(1, async (cs, v) => {
      assert(Array.isArray(v), 'expected value to be an array');
      const [_callback, value] = v;
      return ['continue', value];
    });
    const handlers = createRecord({
      [atom('continue')]: createHandler(continueHandler),
      [atom('break')]: createHandler(breakHandler),
      [ReturnHandler]: (cs, v, cont) => cont(['continue', v]),
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
        context
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
  }),
  [NodeType.LOOP]: unpromisify(async (ast: Tree, context: Context) => {
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
  }),

  [NodeType.BLOCK]: unpromisify(async (ast: Tree, context: Context) => {
    const [expr] = ast.children;
    const breakHandler: EvalFunction = fn(1, async (cs, v) => {
      assert(Array.isArray(v), 'expected value to be an array');
      const [_callback, value] = v;
      return value;
    });
    const continueHandler: EvalFunction = fn(1, async (cs, _v) => {
      await eventLoopYield();
      const _block = block(expr);
      return await evaluateStatement(_block, context);
    });
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
  }),
  [NodeType.SEQUENCE]: unpromisify(async (ast: Tree, context: Context) => {
    const [expr, ...rest] = ast.children;
    if (rest.length === 0) return await evaluateStatement(expr, context);
    const x = await evaluateStatement(expr, context);
    return await mapEffect(
      x,
      async () => await evaluateStatement(sequence(rest), context)
    );
  }),

  [NodeType.INCREMENT]: unpromisify(async (ast: Tree, context: Context) => {
    const [arg] = ast.children;
    assert(arg.type === NodeType.NAME, 'expected name');
    const value = await evaluateExpr(arg, context);
    assert(typeof value === 'number', 'expected number');
    const { matched, envs } = await testPattern(arg, value + 1, context);
    assert(matched, 'expected pattern to match');
    assign(envs, context, getPosition(arg));
    return value + 1;
  }),
  [NodeType.DECREMENT]: unpromisify(async (ast: Tree, context: Context) => {
    const [arg] = ast.children;
    assert(arg.type === NodeType.NAME, 'expected name');
    const value = await evaluateExpr(arg, context);
    assert(typeof value === 'number', 'expected number');
    const { matched, envs } = await testPattern(arg, value - 1, context);
    assert(matched, 'expected pattern to match');
    assign(envs, context, getPosition(arg));
    return value - 1;
  }),
  [NodeType.POST_DECREMENT]: unpromisify(
    async (ast: Tree, context: Context) => {
      const [arg] = ast.children;
      assert(arg.type === NodeType.NAME, 'expected name');
      const value = await evaluateExpr(arg, context);
      assert(typeof value === 'number', 'expected number');
      const { matched, envs } = await testPattern(arg, value - 1, context);
      assert(matched, 'expected pattern to match');
      assign(envs, context, getPosition(arg));
      return value;
    }
  ),
  [NodeType.POST_INCREMENT]: unpromisify(
    async (ast: Tree, context: Context) => {
      const [arg] = ast.children;
      assert(arg.type === NodeType.NAME, 'expected name');
      const value = await evaluateExpr(arg, context);
      assert(typeof value === 'number', 'expected number');
      const { matched, envs } = await testPattern(arg, value + 1, context);
      assert(matched, 'expected pattern to match');
      assign(envs, context, getPosition(arg));
      return value;
    }
  ),

  [NodeType.DECLARE]: unpromisify(async (ast: Tree, context: Context) => {
    const [pattern, expr] = ast.children;
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
  }),
  [NodeType.ASSIGN]: unpromisify(async (ast: Tree, context: Context) => {
    const [pattern, expr] = ast.children;
    const value = await evaluateStatement(expr, context);
    const { matched, envs } = await testPattern(pattern, value, context);
    assert(matched, 'expected pattern to match');
    assign(envs, context, getPosition(pattern));
    return value;
  }),
  [NodeType.INC_ASSIGN]: unpromisify(async (ast: Tree, context: Context) => {
    const [pattern, expr] = ast.children;
    const value = await evaluateExpr(expr, context);
    assert(typeof value === 'number' || Array.isArray(value));
    const { matched, envs } = await testPattern(pattern, value, context);
    assert(matched, 'expected pattern to match');
    incAssign(envs, context, getPosition(pattern));
    return value;
  }),

  [NodeType.LABEL]: unpromisify(async (ast: Tree, context: Context) => {
    return await evaluateStatement(tuple([ast]), context);
  }),
  [NodeType.TUPLE]: unpromisify(async (ast: Tree, context: Context) => {
    const children = ast.children.slice();
    if (children.length === 0) return [];
    const head = children.pop()!;
    const tail = children;
    if (head.type === NodeType.IMPLICIT_PLACEHOLDER) return [];
    if (head.type === NodeType.PLACEHOLDER) return [];

    const _tail = await evaluateStatement(tuple(tail), context);
    assert(isRecord(_tail) || Array.isArray(_tail), 'expected record or tuple');

    const op =
      tupleOperators[head.type as keyof typeof tupleOperators] ??
      tupleOperators[NodeType.TUPLE];
    return await op(head, _tail, context);
  }),
  [NodeType.INDEX]: unpromisify(async (ast: Tree, context: Context) => {
    const [_target, _index] = ast.children;
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
  }),

  [NodeType.PIPE]: unpromisify(async (ast: Tree, context: Context) => {
    const [arg, ...fns] = ast.children;
    let value = await evaluateStatement(arg, context);
    for (const fn of fns) {
      const fnValue = await evaluateExpr(fn, context);
      assert(typeof fnValue === 'function', 'expected function');
      value = await fnPromise(fnValue)([getPosition(fn), context], value);
    }
    return value;
  }),
  [NodeType.SEND]: unpromisify(async (ast: Tree, context: Context) => {
    const [chanAst, valueAst] = ast.children;
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
  }),
  [NodeType.CODE_LABEL]: unpromisify(async (ast: Tree, context: Context) => {
    const expr = ast.children[0];
    const label = Symbol(ast.data.name);
    const labelHandler: EvalFunction = fn(1, async (cs, v) => {
      assert(Array.isArray(v), 'expected v to be an array');
      const [_callback, value] = v;
      assert(Array.isArray(value), 'expected value to be an array');
      const [status, _value] = value;
      if (status === 'break') return _value;
      if (status === 'continue') {
        return await evaluateStatement(ast, context);
      }
      return null;
    });
    const handlers = createRecord({
      [label]: createHandler(labelHandler),
    });
    const labelBreak = fn(1, async (cs, value) => {
      return createEffect(label, ['break', value]);
    });
    const labelContinue = fn(1, async (cs, value) => {
      await eventLoopYield();
      return createEffect(label, ['continue', value]);
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

    return await evaluateHandlers(
      handlers,
      await evaluateStatement(expr, forked),
      getPosition(expr),
      context
    );
  }),
  [NodeType.RECEIVE]: unpromisify(async (ast: Tree, context: Context) => {
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
  }),
  [NodeType.SEND_STATUS]: unpromisify(async (ast: Tree, context: Context) => {
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
  }),
  [NodeType.RECEIVE_STATUS]: unpromisify(
    async (ast: Tree, context: Context) => {
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
  ),

  [NodeType.FUNCTION]: unpromisify(async (ast: Tree, context: Context) => {
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
    const self: EvalFunction = fnCont(async (cs, arg) => {
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

      const returnHandler: EvalFunction = fn(1, async (cs, v) => {
        assert(Array.isArray(v), 'expected value to be an array');
        const [_callback, value] = v;
        return value;
      });

      return await evaluateHandlers(
        createRecord({ [atom('return')]: createHandler(returnHandler) }),
        await evaluateStatement(body, bound),
        getPosition(body),
        context
      );
    });
    return self;
  }),
  [NodeType.APPLICATION]: unpromisify(async (ast: Tree, context: Context) => {
    const [fnExpr, argStmt] = ast.children;
    const [fnValue, argValue] = [
      await evaluateExpr(fnExpr, context),
      await evaluateStatement(argStmt, context),
    ];

    assert(
      typeof fnValue === 'function',
      SystemError.invalidApplicationExpression(getPosition(fnExpr)).withFileId(
        context.fileId
      )
    );

    const x = await fnPromise(fnValue)([getPosition(ast), context], argValue);
    // inspect({ x });
    return x;
  }),
} satisfies Record<
  PropertyKey,
  (ast: Tree, context: Context, cont: (v: EvalValue) => void) => void
>;

const tupleOperators = {
  [NodeType.SPREAD]: async (
    head: Tree,
    _tuple: EvalValue[] | EvalRecord,
    context: Context
  ) => {
    const v = await evaluateExpr(head.children[0], context);
    return await mapEffect(v, async (v) => {
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
        : await evaluateExpr(_key, context);

    return await mapEffect(k, async (key) => {
      const v = await evaluateExpr(head.children[1], context);
      return await mapEffect(v, async (value) => {
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
    return await mapEffect(v, async (v) => [..._tuple, v]);
  },
} satisfies Record<
  PropertyKey,
  (
    ast: Tree,
    _tuple: EvalValue[] | EvalRecord,
    context: Context
  ) => Promise<EvalValue>
>;

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

  if (!isEffect(_value)) {
    const returnHandler = recordGet(handlers, ReturnHandler);
    if (returnHandler === null) return _value;
    assert(
      typeof returnHandler === 'function',
      'expected return handler to be a function'
    );
    return fnPromise(returnHandler)(cs, _value);
  }

  const { effect, value, continuation } = _value;
  const callback: EvalFunctionPromise = async (cs, _value) => {
    const value = await fnPromise(continuation)(cs, _value);
    return await evaluateHandlers(handlers, value, position, context);
  };

  if (!recordHas(handlers, effect)) {
    return createEffect(effect, value, fnCont(callback));
  }

  const handlerValue = recordGet(handlers, effect);
  if (!isHandler(handlerValue)) return await callback(cs, handlerValue);

  const { handler } = handlerValue;
  return await fnPromise(handler)(
    [position, context],
    [fnCont(callback), value]
  );
};

const mapEffect = async (
  value: EvalValue,
  map: (v: EvalValue) => Promise<EvalValue>
): Promise<EvalValue> => {
  if (isEffect(value)) {
    const { effect, value: v, continuation } = value;
    const nextCont: EvalFunction = async (cs, v) => {
      return await fnPromise(continuation)(cs, v).then(map);
    };
    return createEffect(effect, v, nextCont);
  }
  return await map(value);
};

const evaluateStatement = async (
  ast: Tree,
  context: Context
): Promise<EvalValue> => {
  if (ast.type in lazyOperators) {
    const op = lazyOperators[ast.type as keyof typeof lazyOperators];
    const v = await promisify(op)(ast, context);
    if (v instanceof Error) throw v;
    return v;
  }

  if (ast.type in operators) {
    const args: EvalValue[] = [];
    for (const child of ast.children) {
      args.push(await evaluateExpr(child, context));
    }
    return operators[ast.type](...args);
  }

  switch (ast.type) {
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

// const evaluateStatementPromise = promisify<
//   EvalValue,
//   [ast: Tree, context: Context],
//   typeof evaluateStatement
//   >(evaluateStatement);

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
  return await evaluateStatement(sequence(ast.children), context);
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
    const value = await fnPromise(main)(
      [{ start: 0, end: 0 }, newContext(fileId, file)],
      argv
    );
    return value;
  }

  unreachable('file must be a script or a module');
};
