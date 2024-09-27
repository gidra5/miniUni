import { NodeType, Tree } from '../ast.js';
import { environmentAdd, newEnvironment } from '../environment.js';
import { SystemError } from '../error.js';
import { getPosition } from '../parser.js';
import { assert, isEqual, unreachable } from '../utils.js';
import {
  atom,
  EvalValue,
  isRecord,
  isSymbol,
  recordGet,
  recordOmit,
} from '../values.js';
import { Context, evaluateExpr, forkContext } from './index.js';

type PatternTestEnv = Map<string | EvalValue[], EvalValue>;
export type PatternTestEnvs = {
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

export const testPattern = async (
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
    const bound = bindContext(envs, context);
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
      const bound = bindContext(envs, context);
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
            ? await evaluateExpr(key.children[0], bindContext(envs, context))
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
          (await evaluateExpr(pattern.children[1], bindContext(envs, context)));

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

  if (patternAst.type === NodeType.SQUARE_BRACKETS) {
    const name = await evaluateExpr(
      patternAst.children[0],
      bindContext(envs, context)
    );
    if (value === null && flags.strict)
      return { matched: false, envs, notEnvs };
    if (value !== null) updatePatternTestEnv(envs, flags, [name], value);
    return { matched: true, envs, notEnvs };
  }

  // inspect(patternAst);

  unreachable(
    SystemError.invalidPattern(getPosition(patternAst)).withFileId(
      context.fileId
    )
  );
};

export const bind = (envs: PatternTestEnvs, context: Context) => {
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

  // spill redeclared names to forked environment
  if (Object.keys(readonly).length > 0 || Object.keys(env).length > 0) {
    context.readonly = newEnvironment(readonly, context.readonly);
    context.env = newEnvironment(env, context.env);
  }

  assert(
    envs.exports.size === 0,
    'cant do exports not at the top level of a module'
  );

  // inspect({
  //   tag: 'bind 2',
  //   matched,
  //   envs,
  //   context,
  // });
};

export const bindContext = (
  envs: PatternTestEnvs,
  context: Context
): Context => {
  const forked = forkContext(context);
  bind(envs, forked);
  return forked;
};
