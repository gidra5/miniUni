import { Diagnostic, primaryDiagnosticLabel } from 'codespan-napi';
import { SystemError } from './error.js';
import {
  getModule,
  listMethods,
  ModuleDefault,
  prelude,
  preludeHandlers,
  stringMethods,
} from './files.js';
import { getPosition, parseModule, parseScript } from './parser.js';
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
} from './ast.js';
import { parseTokens } from './tokens.js';
import {
  assert,
  getClosestName,
  inspect,
  isEqual,
  unreachable,
} from './utils.js';
import {
  atom,
  awaitTask,
  createChannel,
  createRecord,
  createTask,
  EvalFunction,
  EvalRecord,
  EvalValue,
  fn,
  getChannel,
  isChannel,
  isRecord,
  isSymbol,
  isTask,
  receive,
  recordDelete,
  recordGet,
  recordHas,
  recordMerge,
  recordOmit,
  recordSet,
  send,
  tryReceive,
} from './values.js';
import { validate } from './validate.js';
import { inject, Injectable, register } from './injector.js';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import {
  Handlers,
  maskHandlers,
  newHandlers,
  resolveHandlers,
  withoutHandlers,
  Environment,
  newEnvironment,
  environmentHas,
  environmentKeys,
  environmentGet,
  environmentSet,
  environmentAdd,
} from './environment.js';

let eventLoopYieldCounter = 0;
const eventLoopYieldMax = 1000;
const eventLoopYield = async () => {
  eventLoopYieldCounter = (eventLoopYieldCounter + 1) % eventLoopYieldMax;
  if (eventLoopYieldCounter === 0) await setTimeout(0);
};

export type Context = {
  file: string;
  fileId: number;
  readonly: Environment;
  env: Environment;
  handlers: Handlers;
};

const forkEnv = (env: Context['env']): Context['env'] => {
  return newEnvironment({}, env);
};
const forkContext = (context: Context): Context => {
  return {
    ...context,
    env: forkEnv(context.env),
    readonly: forkEnv(context.readonly),
  };
};

export const newContext = (fileId: number, file: string): Context => {
  return {
    file,
    fileId,
    readonly: forkEnv(prelude),
    env: forkEnv(prelude),
    handlers: newHandlers({}, preludeHandlers),
  };
};

type PatternTestEnv = Map<string | EvalValue[], EvalValue>;
type PatternTestEnvs = {
  env: PatternTestEnv;
  readonly: PatternTestEnv;
  exports: PatternTestEnv;
};
type PatternTestResult = {
  matched: boolean;
  envs: PatternTestEnvs;
  notEnvs: PatternTestEnvs;
};
type PatternTestFlags = {
  mutable: boolean; // bound names should be marked as mutable
  export: boolean; // bound names should be marked as exported
  strict: boolean; // strict matching, do not report match if value is null
};

const mergePatternTestEnvs = (
  a: PatternTestEnvs,
  b: PatternTestEnvs
): PatternTestEnvs => {
  return {
    env: new Map([...a.env, ...b.env]),
    readonly: new Map([...a.readonly, ...b.readonly]),
    exports: new Map([...a.exports, ...b.exports]),
  };
};

const mergePatternTestResult = (
  a: PatternTestResult,
  b: PatternTestResult
): PatternTestResult => {
  return {
    matched: a.matched && b.matched,
    envs: mergePatternTestEnvs(a.envs, b.envs),
    notEnvs: mergePatternTestEnvs(a.notEnvs, b.notEnvs),
  };
};

const updatePatternTestEnv = (
  envs: PatternTestEnvs,
  flags: PatternTestFlags,
  key: string | EvalValue[],
  value: EvalValue
): PatternTestEnvs => {
  if (flags.mutable) envs.env.set(key, value);
  else if (flags.export) envs.exports.set(key, value);
  else envs.readonly.set(key, value);
  return envs;
};

const testPattern = async (
  patternAst: Tree,
  value: EvalValue,
  context: Readonly<Context>,
  envs: PatternTestEnvs = {
    env: new Map(),
    readonly: new Map(),
    exports: new Map(),
  },
  notEnvs: PatternTestEnvs = {
    env: new Map(),
    readonly: new Map(),
    exports: new Map(),
  },
  flags: PatternTestFlags = { mutable: false, export: false, strict: true }
): Promise<PatternTestResult> => {
  // inspect({
  //   patternAst,
  //   value,
  //   envs,
  // });

  if (patternAst.type === NodeType.PLACEHOLDER) {
    return { matched: true, envs, notEnvs };
  }

  if (patternAst.type === NodeType.IMPLICIT_PLACEHOLDER) {
    return { matched: true, envs, notEnvs };
  }

  if (patternAst.type === NodeType.PARENS) {
    return await testPattern(
      patternAst.children[0],
      value,
      context,
      envs,
      notEnvs,
      flags
    );
  }

  if (patternAst.type === NodeType.NOT) {
    const result = await testPattern(
      patternAst.children[0],
      value,
      context,
      envs,
      notEnvs,
      flags
    );
    return {
      matched: !result.matched,
      envs: mergePatternTestEnvs(result.envs, notEnvs),
      notEnvs: mergePatternTestEnvs(result.notEnvs, envs),
    };
  }

  if (patternAst.type === NodeType.NUMBER) {
    if (typeof value !== 'number') return { matched: false, envs, notEnvs };
    return { matched: value === patternAst.data.value, envs, notEnvs };
  }

  if (patternAst.type === NodeType.STRING) {
    if (typeof value !== 'string') return { matched: false, envs, notEnvs };
    return { matched: value === patternAst.data.value, envs, notEnvs };
  }

  if (patternAst.type === NodeType.ATOM) {
    if (!isSymbol(value)) return { matched: false, envs, notEnvs };
    return {
      matched: value === atom(patternAst.data.name),
      envs,
      notEnvs,
    };
  }

  if (patternAst.type === NodeType.PIN) {
    const bound = await bind(envs, context);
    const _value = await evaluateExpr(patternAst.children[0], bound);
    return { matched: isEqual(_value, value), envs, notEnvs };
  }

  if (patternAst.type === NodeType.ASSIGN) {
    const pattern = patternAst.children[0];
    const result = await testPattern(
      pattern,
      value,
      context,
      envs,
      notEnvs,
      flags
    );
    // inspect({
    //   tag: 'testPattern assign',
    //   result,
    //   value,
    //   pattern,
    // });
    if (!result.matched) {
      const bound = await bind(envs, context);
      const _value = await evaluateExpr(patternAst.children[1], bound);
      const _result = await testPattern(
        pattern,
        _value,
        context,
        envs,
        notEnvs,
        flags
      );
      // inspect({
      //   tag: 'testPattern assign 2',
      //   result,
      //   value,
      //   pattern,
      //   _value,
      //   _result,
      // });
      return _result;
    }
    return result;
  }

  if (patternAst.type === NodeType.BIND) {
    const pattern = patternAst.children[0];
    const bindPattern = patternAst.children[1];
    const result = await testPattern(
      pattern,
      value,
      context,
      envs,
      notEnvs,
      flags
    );
    const bindResult = await testPattern(
      bindPattern,
      value,
      context,
      envs,
      notEnvs,
      flags
    );
    return mergePatternTestResult(result, bindResult);
  }

  if (patternAst.type === NodeType.EXPORT) {
    assert(!flags.mutable, 'export cannot be mutable');
    return await testPattern(
      patternAst.children[0],
      value,
      context,
      envs,
      notEnvs,
      { ...flags, export: true }
    );
  }

  if (patternAst.type === NodeType.MUTABLE) {
    assert(!flags.export, 'export cannot be mutable');
    return await testPattern(
      patternAst.children[0],
      value,
      context,
      envs,
      notEnvs,
      { ...flags, mutable: true }
    );
  }

  if (patternAst.type === NodeType.LIKE) {
    return await testPattern(
      patternAst.children[0],
      value,
      context,
      envs,
      notEnvs,
      { ...flags, strict: false }
    );
  }

  if (patternAst.type === NodeType.STRICT) {
    return await testPattern(
      patternAst.children[0],
      value,
      context,
      envs,
      notEnvs,
      { ...flags, strict: true }
    );
  }

  if (patternAst.type === NodeType.TUPLE) {
    if (!Array.isArray(value)) return { matched: false, envs, notEnvs };

    const patterns = patternAst.children;
    let consumed = 0;
    for (const pattern of patterns) {
      if (pattern.type === NodeType.SPREAD) {
        const start = consumed++;
        consumed = value.length - patterns.length + consumed;
        const rest = value.slice(start, Math.max(start, consumed));
        const result = await testPattern(
          pattern.children[0],
          rest,
          context,
          envs,
          notEnvs,
          flags
        );
        envs = mergePatternTestEnvs(envs, result.envs);
        continue;
      } else {
        const v = value[consumed++] ?? null;
        const result = await testPattern(
          pattern,
          v,
          context,
          envs,
          notEnvs,
          flags
        );
        // inspect({
        //   tag: 'testPattern tuple',
        //   result,
        //   value,
        //   v,
        //   pattern,
        //   consumed,
        //   overconsumed: value.length < consumed,
        //   flags,
        // });
        envs = mergePatternTestEnvs(envs, result.envs);
        if (!result.matched) return { matched: false, envs, notEnvs };
        continue;
      }
    }

    return { matched: true, envs, notEnvs };
  }

  if (patternAst.type === NodeType.RECORD) {
    if (!isRecord(value)) return { matched: false, envs, notEnvs };

    const patterns = patternAst.children;
    const consumedNames: string[] = [];

    for (const pattern of patterns) {
      if (pattern.type === NodeType.NAME) {
        const name = pattern.data.value;
        const _value = recordGet(value, name);
        if (_value === null && flags.strict)
          return { matched: false, envs, notEnvs };
        if (_value !== null) updatePatternTestEnv(envs, flags, name, _value);

        consumedNames.push(name);
        continue;
      } else if (pattern.type === NodeType.LABEL) {
        const [key, valuePattern] = pattern.children;
        const name =
          key.type === NodeType.SQUARE_BRACKETS
            ? await evaluateExpr(key.children[0], await bind(envs, context))
            : key.type === NodeType.NAME
            ? key.data.value
            : null;
        if (name === null) return { matched: false, envs, notEnvs };
        const _value = recordGet(value, name);
        if (_value === null && flags.strict)
          return { matched: false, envs, notEnvs };
        consumedNames.push(name);
        const result = await testPattern(
          valuePattern,
          _value,
          context,
          envs,
          notEnvs,
          flags
        );
        envs = mergePatternTestEnvs(envs, result.envs);
        if (!result.matched) return { matched: false, envs, notEnvs };
        continue;
      } else if (pattern.type === NodeType.SPREAD) {
        const rest = recordOmit(value, consumedNames);
        const result = await testPattern(
          pattern.children[0],
          rest,
          context,
          envs,
          notEnvs,
          flags
        );
        envs = mergePatternTestEnvs(envs, result.envs);
        if (!result.matched) return { matched: false, envs, notEnvs };
        continue;
      } else if (pattern.type === NodeType.ASSIGN) {
        const _pattern = pattern.children[0];
        assert(_pattern.type === NodeType.NAME, 'expected name');
        const name = _pattern.data.value;
        const _value =
          recordGet(value, name) ??
          (await evaluateExpr(pattern.children[1], await bind(envs, context)));

        if (_value === null && flags.strict)
          return { matched: false, envs, notEnvs };
        if (_value !== null) updatePatternTestEnv(envs, flags, name, _value);

        consumedNames.push(name);
        continue;
      }

      // inspect({
      //   tag: 'testPattern record',
      //   record,
      //   pattern,
      //   consumedNames,
      //   flags,
      // });

      unreachable(
        SystemError.invalidObjectPattern(getPosition(pattern)).withFileId(
          context.fileId
        )
      );
    }

    return { matched: true, envs, notEnvs };
  }

  if (patternAst.type === NodeType.INDEX) {
    const list = await evaluateExpr(patternAst.children[0], context);
    const index = await evaluateExpr(patternAst.children[1], context);
    if (Array.isArray(list)) {
      assert(
        Number.isInteger(index),
        SystemError.invalidIndex(getPosition(patternAst)).withFileId(
          context.fileId
        )
      );
      assert(typeof index === 'number');
      updatePatternTestEnv(envs, flags, [list, index], value);
      return { matched: true, envs, notEnvs };
    } else if (isRecord(list)) {
      updatePatternTestEnv(envs, flags, [list, index], value);
      return { matched: true, envs, notEnvs };
    }

    unreachable(
      SystemError.invalidIndexTarget(getPosition(patternAst)).withFileId(
        context.fileId
      )
    );
  }

  if (patternAst.type === NodeType.NAME) {
    const name = patternAst.data.value;
    if (value === null && flags.strict)
      return { matched: false, envs, notEnvs };
    if (value !== null) updatePatternTestEnv(envs, flags, name, value);
    return { matched: true, envs, notEnvs };
  }

  // inspect(patternAst);

  unreachable(
    SystemError.invalidPattern(getPosition(patternAst)).withFileId(
      context.fileId
    )
  );
};

const incAssign = async (
  patternAst: Tree,
  value: number | EvalValue[],
  context: Context
): Promise<Context> => {
  const { matched, envs } = await testPattern(patternAst, value, context);
  assert(matched, 'expected pattern to match');

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
        'expected mutable name'
      );
      assert(
        environmentHas(context.env, patternKey),
        SystemError.invalidAssignment(
          patternKey,
          getPosition(patternAst),
          getClosestName(
            patternKey,
            environmentKeys(context.env).filter((k) => typeof k === 'string')
          )
        ).withFileId(context.fileId)
      );

      const v = environmentGet(context.env, patternKey);
      assert(
        typeof v === 'number',
        SystemError.invalidIncrement(
          String(patternKey),
          getPosition(patternAst)
        ).withFileId(context.fileId)
      );
      assert(
        typeof value === 'number',
        SystemError.invalidIncrement(
          String(patternKey),
          getPosition(patternAst)
        ).withFileId(context.fileId)
      );
      environmentSet(context.env, patternKey, v + value);
    } else {
      const [patternTarget, patternKeyValue] = patternKey;
      if (Array.isArray(patternTarget)) {
        assert(
          typeof patternKeyValue === 'number',
          SystemError.invalidIndex(getPosition(patternAst)).withFileId(
            context.fileId
          )
        );
        const v = patternTarget[patternKeyValue];
        assert(
          typeof v === 'number',
          SystemError.invalidIncrement(
            String(patternKeyValue),
            getPosition(patternAst)
          ).withFileId(context.fileId)
        );
        assert(
          typeof value === 'number',
          SystemError.invalidIncrement(
            String(patternKeyValue),
            getPosition(patternAst)
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
            getPosition(patternAst)
          ).withFileId(context.fileId)
        );
        assert(
          typeof value === 'number',
          SystemError.invalidIncrement(
            String(patternKeyValue),
            getPosition(patternAst)
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

  return context;
};

const assign = async (
  patternAst: Tree,
  value: EvalValue,
  context: Context
): Promise<Context> => {
  // inspect({
  //   tag: 'assign',
  //   patternAst,
  //   value,
  //   context,
  // });
  const { matched, envs } = await testPattern(patternAst, value, context);
  assert(matched, 'expected pattern to match');

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
        'expected mutable name'
      );
      assert(
        environmentSet(context.env, patternKey, value),
        SystemError.invalidAssignment(
          patternKey,
          getPosition(patternAst),
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
          SystemError.invalidIndex(getPosition(patternAst)).withFileId(
            context.fileId
          )
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

  return context;
};

const bind = async (
  envs: PatternTestEnvs,
  context: Context
): Promise<Context> => {
  const readonly = {};
  const env = {};

  // inspect({
  //   tag: 'bind',
  //   matched,
  //   envs,
  //   context,
  // });

  for (const [key, value] of envs.readonly.entries()) {
    assert(typeof key === 'string', 'can only declare names');

    if (value === null) continue;
    if (context.readonly.entries.has(key)) readonly[key] = value;
    else if (context.env.entries.has(key)) readonly[key] = value;
    else environmentAdd(context.readonly, key, value);
  }
  for (const [key, value] of envs.env.entries()) {
    assert(typeof key === 'string', 'can only declare names');

    if (value === null) continue;
    if (context.readonly.entries.has(key)) env[key] = value;
    else if (context.env.entries.has(key)) env[key] = value;
    else environmentAdd(context.env, key, value);
  }

  if (Object.keys(readonly).length > 0 || Object.keys(env).length > 0) {
    context.readonly = newEnvironment(readonly, context.readonly);
    context.env = newEnvironment(env, context.env);
  }

  assert(envs.exports.size === 0, 'cant do exports in scripts');

  // inspect({
  //   tag: 'bind 2',
  //   matched,
  //   envs,
  //   context,
  // });

  return context;
};

async function bindExport(
  patternAst: Tree,
  value: EvalValue,
  exports: EvalRecord,
  context: Context
): Promise<EvalRecord> {
  const { matched, envs } = await testPattern(patternAst, value, context);

  assert(matched, 'expected pattern to match');

  for (const [key, value] of envs.readonly.entries()) {
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
    environmentSet(context.readonly, key, value);
  }
  for (const [key, value] of envs.env.entries()) {
    assert(typeof key === 'string', 'can only declare names');
    // TODO: fork scope on duplicate declaration.
    assert(
      !context.readonly.entries.has(key),
      'cannot declare name inside module more than once'
    );
    assert(
      !context.env.entries.has(key),
      'cannot declare name inside module more than once'
    );

    if (value === null) continue;
    environmentSet(context.env, key, value);
  }
  for (const [key, value] of envs.exports.entries()) {
    assert(typeof key === 'string', 'can only declare names');
    // TODO: fork scope on duplicate declaration.
    assert(
      !context.readonly.entries.has(key),
      'cannot declare name inside module more than once'
    );
    assert(
      !context.env.entries.has(key),
      'cannot declare name inside module more than once'
    );

    if (value === null) continue;
    environmentSet(context.readonly, key, value);
  }
  for (const [key, value] of envs.exports.entries()) {
    assert(typeof key === 'string', 'can only declare names');

    if (value === null) continue;
    recordSet(exports, key, value);
  }

  return exports;
}

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
    return await evaluateBlock(body, { ...context, handlers });
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
        const forked = forkContext(context);
        await bind(result.envs, forked);
        return await evaluateBlock(body, forked);
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

      const forked = forkContext(context);
      if (result.matched) {
        await bind(result.envs, forked);
        return await evaluateBlock(trueBranch, forked);
      } else {
        await bind(result.notEnvs, forked);
        return await evaluateBlock(falseBranch, forked);
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
      const _context = forkContext(forked);
      try {
        const result = await testPattern(pattern, item, _context);
        assert(result.matched, 'expected pattern to match');
        const bound = await bind(result.envs, _context);
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
    await evaluateStatement(expr, context);
    return await lazyOperators[NodeType.SEQUENCE](rest, context);
  },

  [NodeType.INCREMENT]: async ([arg]: Tree[], context: Context) => {
    assert(arg.type === NodeType.NAME, 'expected name');
    const value = await evaluateExpr(arg, context);
    assert(typeof value === 'number', 'expected number');
    await assign(arg, value + 1, context);
    return value + 1;
  },
  [NodeType.DECREMENT]: async ([arg]: Tree[], context: Context) => {
    assert(arg.type === NodeType.NAME, 'expected name');
    const value = await evaluateExpr(arg, context);
    assert(typeof value === 'number', 'expected number');
    await assign(arg, value - 1, context);
    return value - 1;
  },
  [NodeType.POST_DECREMENT]: async ([arg]: Tree[], context: Context) => {
    assert(arg.type === NodeType.NAME, 'expected name');
    const value = await evaluateExpr(arg, context);
    assert(typeof value === 'number', 'expected number');
    await assign(arg, value - 1, context);
    return value;
  },
  [NodeType.POST_INCREMENT]: async ([arg]: Tree[], context: Context) => {
    assert(arg.type === NodeType.NAME, 'expected name');
    const value = await evaluateExpr(arg, context);
    assert(typeof value === 'number', 'expected number');
    await assign(arg, value + 1, context);
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
    await bind(result.envs, context);
    return value;
  },
  [NodeType.ASSIGN]: async ([pattern, expr]: Tree[], context: Context) => {
    const value = await evaluateStatement(expr, context);
    await assign(pattern, value, context);
    return value;
  },
  [NodeType.INC_ASSIGN]: async ([pattern, expr]: Tree[], context: Context) => {
    const value = await evaluateExpr(expr, context);
    assert(typeof value === 'number' || Array.isArray(value));
    await incAssign(pattern, value, context);
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
    const list: EvalValue[] = [];
    let record: EvalRecord = createRecord();

    for (const child of children) {
      if (child.type === NodeType.SPREAD) {
        const rest = await evaluateExpr(child.children[0], context);
        if (Array.isArray(rest)) list.push(...rest);
        else if (isRecord(rest)) record = recordMerge(record, rest);
        else {
          unreachable(
            SystemError.invalidTuplePattern(getPosition(child)).withFileId(
              context.fileId
            )
          );
        }
      } else if (child.type === NodeType.LABEL) {
        const _key = child.children[0];
        const key =
          _key.type === NodeType.NAME
            ? _key.data.value
            : await evaluateExpr(_key, context);
        const value = await evaluateExpr(child.children[1], context);
        recordSet(record, key, value);
      } else if (child.type === NodeType.IMPLICIT_PLACEHOLDER) continue;
      else list.push(await evaluateExpr(child, context));
    }

    if (record.size > 0) {
      Object.assign(record, list);
      // inspect({
      //   tag: 'evaluateExpr tuple record',
      //   record,
      //   children,
      //   context,
      // });

      return record;
    }

    // inspect({
    //   tag: 'evaluateExpr tuple list',
    //   list,
    //   children,
    //   context,
    // });
    return list;
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
        return await listMethods[index](target, [
          getPosition(_index),
          context.fileId,
        ]);
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
      return await stringMethods[index](target, [
        getPosition(_index),
        context.fileId,
      ]);
    }

    unreachable(
      SystemError.invalidIndexTarget(getPosition(_index)).withFileId(
        context.fileId
      )
    );
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

export const evaluateStatement = async (
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
        await bind(result.envs, context);
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
      const self: EvalFunction = async (
        [position, fileId, callerContext],
        arg
      ) => {
        await eventLoopYield();
        const __context = forkContext(_context);
        const result = await testPattern(pattern, arg, __context);
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
        const bound = await bind(result.envs, __context);
        if (isTopFunction) {
          environmentAdd(bound.env, 'self', self);
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

      return await fnValue(
        [getPosition(ast), context.fileId, context],
        argValue
      );
    }

    case NodeType.ATOM: {
      return atom(ast.data.name);
    }

    case NodeType.NAME: {
      const name = ast.data.value;
      if (name === 'true') return true;
      if (name === 'false') return false;
      if (name === 'injected') return resolveHandlers(context.handlers);
      assert(
        environmentHas(context.env, name) ||
          environmentHas(context.readonly, name),
        SystemError.undeclaredName(name, getPosition(ast)).withFileId(
          context.fileId
        )
      );
      // inspect({
      //   tag: 'evaluateExpr name',
      //   name,
      //   env: context.env,
      //   readonly: context.readonly,
      // });
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

export const evaluateBlock = async (
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

  for (const child of ast.children) {
    if (child.type === NodeType.EXPORT) {
      const exportNode = child.children[0];

      if (exportNode.type === NodeType.DECLARE) {
        const [pattern, expr] = exportNode.children;
        const value = await evaluateExpr(expr, context);
        const result = await testPattern(pattern, value, context);
        assert(result.matched, 'expected pattern to match');
        await bindExport(pattern, value, record, context);
      } else {
        const value = await evaluateExpr(exportNode, context);

        assert(
          !recordHas(record, ModuleDefault),
          SystemError.duplicateDefaultExport(
            getPosition(exportNode)
          ).withFileId(context.fileId)
        );

        recordSet(record, ModuleDefault, value);
      }
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
      [{ start: 0, end: 0 }, 0, newContext(fileId, file)],
      argv
    );
    return value;
  }

  unreachable('file must be a script or a module');
};
