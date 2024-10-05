import { NodeType, Tree } from '../ast.js';
import { Environment } from '../environment.js';
import { SystemError } from '../error.js';
import { getPosition } from '../parser.js';
import { assert, isEqual, unreachable } from '../utils.js';
import {
  atom,
  EvalRecord,
  EvalValue,
  isRecord,
  isSymbol,
  recordGet,
  recordOmit,
} from '../values.js';
import {
  CompileContext,
  compileExpr,
  EvalContext,
  evaluateExpr,
  forkContext,
} from './index.js';

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

export const compilePattern = (
  patternAst: Tree,
  context: CompileContext,
  flags: PatternTestFlags = { mutable: false, export: false, strict: true }
) => {
  const compiled = _compilePattern(patternAst, context, flags);
  return (
    value: EvalValue,
    evalContext: Readonly<EvalContext>,
    envs: PatternTestEnvs = {
      env: new Map(),
      readonly: new Map(),
      exports: new Map(),
    },
    notEnvs: PatternTestEnvs = {
      env: new Map(),
      readonly: new Map(),
      exports: new Map(),
    }
  ) => {
    return compiled(value, evalContext, envs, notEnvs);
  };
};

type CompiledPattern = (
  value: EvalValue,
  context: Readonly<EvalContext>,
  envs: PatternTestEnvs,
  notEnvs: PatternTestEnvs
) => Promise<PatternTestResult>;

const _compilePattern = (
  patternAst: Tree,
  context: CompileContext,
  flags: PatternTestFlags = { mutable: false, export: false, strict: true }
): CompiledPattern => {
  if (patternAst.type === NodeType.PLACEHOLDER) {
    return async (_value, _context, envs, notEnvs) => ({
      matched: true,
      envs,
      notEnvs,
    });
  }

  if (patternAst.type === NodeType.IMPLICIT_PLACEHOLDER) {
    return async (_value, _context, envs, notEnvs) => ({
      matched: true,
      envs,
      notEnvs,
    });
  }

  if (patternAst.type === NodeType.PARENS) {
    return _compilePattern(patternAst.children[0], context, flags);
  }

  if (patternAst.type === NodeType.NUMBER) {
    const _value = patternAst.data.value;
    return async (value, _context, envs, notEnvs) => {
      if (typeof value !== 'number') return { matched: false, envs, notEnvs };
      return { matched: value === _value, envs, notEnvs };
    };
  }

  if (patternAst.type === NodeType.STRING) {
    const _value = patternAst.data.value;
    return async (value, _context, envs, notEnvs) => {
      if (typeof value !== 'string') return { matched: false, envs, notEnvs };
      return { matched: value === _value, envs, notEnvs };
    };
  }

  if (patternAst.type === NodeType.ATOM) {
    const _atom = atom(patternAst.data.name);
    return async (value, _context, envs, notEnvs) => {
      if (!isSymbol(value)) return { matched: false, envs, notEnvs };
      const equal = value === _atom;
      return { matched: equal, envs, notEnvs };
    };
  }

  if (patternAst.type === NodeType.EXPORT) {
    assert(!flags.mutable, 'export cannot be mutable');
    flags = { ...flags, export: true };
    return _compilePattern(patternAst.children[0], context, flags);
  }

  if (patternAst.type === NodeType.MUTABLE) {
    assert(!flags.export, 'export cannot be mutable');
    flags = { ...flags, mutable: true };
    return _compilePattern(patternAst.children[0], context, flags);
  }

  if (patternAst.type === NodeType.LIKE) {
    flags = { ...flags, strict: false };
    return _compilePattern(patternAst.children[0], context, flags);
  }

  if (patternAst.type === NodeType.STRICT) {
    flags = { ...flags, strict: true };
    return _compilePattern(patternAst.children[0], context, flags);
  }

  if (patternAst.type === NodeType.PIN) {
    const compiledExpr = compileExpr(patternAst.children[0], context);
    return async (value, context, envs, notEnvs) => {
      const bound = bindContext(envs, context);
      const _value = await compiledExpr(bound);
      return { matched: isEqual(_value, value), envs, notEnvs };
    };
  }

  if (patternAst.type === NodeType.NOT) {
    const compiled = _compilePattern(patternAst.children[0], context, flags);
    return async (
      value: EvalValue,
      context: Readonly<EvalContext>,
      envs: PatternTestEnvs,
      notEnvs: PatternTestEnvs
    ) => {
      const result = await compiled(value, context, envs, notEnvs);
      return {
        matched: !result.matched,
        envs: mergePatternTestEnvs(result.envs, notEnvs),
        notEnvs: mergePatternTestEnvs(result.notEnvs, envs),
      };
    };
  }

  if (patternAst.type === NodeType.ASSIGN) {
    const pattern = patternAst.children[0];
    const compiledPattern = _compilePattern(pattern, context, flags);
    const compiledExpr = compileExpr(patternAst.children[1], context);
    return async (value, context, envs, notEnvs) => {
      const result = await compiledPattern(value, context, envs, notEnvs);
      if (!result.matched) {
        const bound = bindContext(envs, context);
        const _value = await compiledExpr(bound);
        const _result = await compiledPattern(_value, context, envs, notEnvs);
        return _result;
      }
      return result;
    };
  }

  if (patternAst.type === NodeType.BIND) {
    const pattern = patternAst.children[0];
    const bindPattern = patternAst.children[1];
    const compiledPattern = _compilePattern(pattern, context, flags);
    const compiledBindPattern = _compilePattern(bindPattern, context, flags);

    return async (value, context, envs, notEnvs) => {
      const result = await compiledPattern(value, context, envs, notEnvs);
      const bindResult = await compiledBindPattern(
        value,
        context,
        envs,
        notEnvs
      );
      return mergePatternTestResult(result, bindResult);
    };
  }

  if (patternAst.type === NodeType.NAME) {
    const name = patternAst.data.value;

    if (flags.strict) {
      return async (value, _context, envs, notEnvs) => {
        if (value === null) return { matched: false, envs, notEnvs };
        if (value !== null) updatePatternTestEnv(envs, flags, name, value);
        return { matched: true, envs, notEnvs };
      };
    }
    return async (value, _context, envs, notEnvs) => {
      if (value !== null) updatePatternTestEnv(envs, flags, name, value);
      return { matched: true, envs, notEnvs };
    };
  }

  if (patternAst.type === NodeType.SQUARE_BRACKETS) {
    const compiledExpr = compileExpr(patternAst.children[0], context);

    if (flags.strict) {
      return async (value, context, envs, notEnvs) => {
        const name = await compiledExpr(bindContext(envs, context));
        if (value === null) return { matched: false, envs, notEnvs };
        if (value !== null) updatePatternTestEnv(envs, flags, [name], value);
        return { matched: true, envs, notEnvs };
      };
    }
    return async (value, context, envs, notEnvs) => {
      const name = await compiledExpr(bindContext(envs, context));
      if (value !== null) updatePatternTestEnv(envs, flags, [name], value);
      return { matched: true, envs, notEnvs };
    };
  }

  if (patternAst.type === NodeType.INDEX) {
    const compiledExpr = compileExpr(patternAst.children[0], context);
    const compiledIndex = compileExpr(patternAst.children[1], context);
    const invalidIndexError = SystemError.invalidIndex(
      getPosition(patternAst.children[1])
    ).withFileId(context.fileId);
    const invalidIndexTargetError = SystemError.invalidIndexTarget(
      getPosition(patternAst.children[0])
    ).withFileId(context.fileId);

    return async (value, context, envs, notEnvs) => {
      const list = await compiledExpr(context);
      const index = await compiledIndex(context);

      if (Array.isArray(list)) {
        assert(Number.isInteger(index), invalidIndexError);
        assert(typeof index === 'number');
        updatePatternTestEnv(envs, flags, [list, index], value);
        return { matched: true, envs, notEnvs };
      } else if (isRecord(list)) {
        updatePatternTestEnv(envs, flags, [list, index], value);
        return { matched: true, envs, notEnvs };
      }

      unreachable(invalidIndexTargetError);
    };
  }

  if (patternAst.type === NodeType.TUPLE) {
    const patterns = patternAst.children;
    assert(
      patterns.filter((x) => x.type === NodeType.SPREAD).length <= 1,
      'expected at most one spread'
    );
    const spreadPatternIndex = patterns.findIndex(
      (x) => x.type === NodeType.SPREAD
    );

    if (spreadPatternIndex === -1) {
      const compiledPatterns = patterns.map((x) =>
        _compilePattern(x, context, flags)
      );

      return async (value, context, envs, notEnvs) => {
        if (!Array.isArray(value)) return { matched: false, envs, notEnvs };

        let consumed = 0;
        for (const pattern of compiledPatterns) {
          const v = value[consumed++] ?? null;
          const result = await pattern(v, context, envs, notEnvs);
          envs = mergePatternTestEnvs(envs, result.envs);
          if (!result.matched) return { matched: false, envs, notEnvs };
        }

        return { matched: true, envs, notEnvs };
      };
    }

    const spreadPattern = _compilePattern(
      patterns[spreadPatternIndex].children[0],
      context,
      flags
    );
    const preSpreadPatterns = patterns
      .slice(0, spreadPatternIndex)
      .map((x) => _compilePattern(x, context, flags));
    const postSpreadPatterns = patterns
      .slice(spreadPatternIndex + 1)
      .map((x) => _compilePattern(x, context, flags));
    const preSpreadPatternsLength = preSpreadPatterns.length;
    const postSpreadPatternsLength = postSpreadPatterns.length;

    return async (value, context, envs, notEnvs) => {
      if (!Array.isArray(value)) return { matched: false, envs, notEnvs };

      const spreadRange = [
        preSpreadPatternsLength,
        Math.max(
          preSpreadPatternsLength,
          value.length - postSpreadPatternsLength
        ),
      ];

      let consumed = 0;
      for (const pattern of preSpreadPatterns) {
        const v = value[consumed++] ?? null;
        const result = await pattern(v, context, envs, notEnvs);
        envs = mergePatternTestEnvs(envs, result.envs);
        if (!result.matched) return { matched: false, envs, notEnvs };
      }

      consumed = spreadRange[1];
      const rest = value.slice(spreadRange[0], spreadRange[1]);
      const result = await spreadPattern(rest, context, envs, notEnvs);
      envs = mergePatternTestEnvs(envs, result.envs);

      for (const pattern of postSpreadPatterns) {
        const v = value[consumed++] ?? null;
        const result = await pattern(v, context, envs, notEnvs);
        envs = mergePatternTestEnvs(envs, result.envs);
        if (!result.matched) return { matched: false, envs, notEnvs };
      }

      return { matched: true, envs, notEnvs };
    };
  }

  if (patternAst.type === NodeType.RECORD) {
    const patterns = patternAst.children;
    type CompiledNamePattern = (
      value: EvalRecord,
      envs: PatternTestEnvs
    ) => [boolean, string, PatternTestEnvs];
    type CompiledLabelPattern = (
      value: EvalValue,
      context: Readonly<EvalContext>,
      envs: PatternTestEnvs,
      notEnvs: PatternTestEnvs
    ) => Promise<[boolean, EvalValue, PatternTestEnvs, PatternTestEnvs]>;
    type CompiledAssignPattern = (
      value: EvalRecord,
      context: Readonly<EvalContext>,
      envs: PatternTestEnvs
    ) => Promise<[boolean, string, PatternTestEnvs]>;

    const namePatterns = patterns
      .filter((x) => x.type === NodeType.NAME)
      .map((pattern): CompiledNamePattern => {
        const name = pattern.data.value;
        if (flags.strict) {
          return (value, envs) => {
            const _value = recordGet(value, name);
            if (_value !== null)
              updatePatternTestEnv(envs, flags, name, _value);
            if (_value === null && flags.strict) return [false, name, envs];
            return [true, name, envs];
          };
        } else {
          return (value, envs) => {
            const _value = recordGet(value, name);
            if (_value !== null)
              updatePatternTestEnv(envs, flags, name, _value);

            return [true, name, envs];
          };
        }
      });
    const labelPatterns = patterns
      .filter((x) => x.type === NodeType.LABEL)
      .map((pattern): CompiledLabelPattern => {
        const [keyNode, valuePattern] = pattern.children;
        const compiledPattern = _compilePattern(valuePattern, context, flags);
        const compiledKey =
          keyNode.type === NodeType.SQUARE_BRACKETS
            ? compileExpr(keyNode.children[0], context)
            : keyNode.type === NodeType.NAME
            ? async () => keyNode.data.value
            : async () => null;

        if (flags.strict) {
          return async (value, context, envs, notEnvs) => {
            assert(isRecord(value));
            const name = await compiledKey(bindContext(envs, context));
            if (name === null) return [false, name, envs, notEnvs];
            const _value = recordGet(value, name);
            if (_value === null) return [false, name, envs, notEnvs];
            const result = await compiledPattern(
              _value,
              context,
              envs,
              notEnvs
            );
            envs = mergePatternTestEnvs(envs, result.envs);
            return [result.matched, name, envs, notEnvs];
          };
        }

        return async (value, context, envs, notEnvs) => {
          assert(isRecord(value));
          const name = await compiledKey(bindContext(envs, context));
          if (name === null) return [false, name, envs, notEnvs];
          const _value = recordGet(value, name);
          const result = await compiledPattern(_value, context, envs, notEnvs);
          envs = mergePatternTestEnvs(envs, result.envs);
          return [result.matched, name, envs, notEnvs];
        };
      });
    const assignPatterns = patterns
      .filter((x) => x.type === NodeType.ASSIGN)
      .map((pattern): CompiledAssignPattern => {
        const _pattern = pattern.children[0];
        assert(_pattern.type === NodeType.NAME, 'expected name');
        const name = _pattern.data.value;
        const compiledExpr = compileExpr(pattern.children[1], context);

        if (flags.strict) {
          return async (value, context, envs) => {
            const _value =
              recordGet(value, name) ??
              (await compiledExpr(bindContext(envs, context)));

            if (_value === null) return [false, name, envs];
            if (_value !== null)
              updatePatternTestEnv(envs, flags, name, _value);

            return [true, name, envs];
          };
        }

        return async (value, context, envs) => {
          const _value =
            recordGet(value, name) ??
            (await compiledExpr(bindContext(envs, context)));
          if (_value !== null) updatePatternTestEnv(envs, flags, name, _value);

          return [true, name, envs];
        };
      });
    const spreadPattern = patterns.find((x) => x.type === NodeType.SPREAD);
    const invalidRecordPatternError = SystemError.invalidObjectPattern(
      getPosition(patternAst)
    ).withFileId(context.fileId);
    assert(
      patterns.filter((x) => x.type === NodeType.SPREAD).length <= 1,
      'expected at most one spread'
    );
    assert(
      patterns.filter(
        (x) =>
          x.type !== NodeType.NAME &&
          x.type !== NodeType.LABEL &&
          x.type !== NodeType.ASSIGN &&
          x.type !== NodeType.SPREAD
      ).length === 0,
      invalidRecordPatternError
    );
    const compiledKeyPatterns = async (
      value: EvalRecord,
      context: Readonly<EvalContext>,
      envs: PatternTestEnvs,
      notEnvs: PatternTestEnvs
    ): Promise<[PatternTestResult, EvalValue[]]> => {
      const consumedNames: EvalValue[] = [];

      for (const pattern of namePatterns) {
        const [matched, name, _envs] = pattern(value, envs);
        envs = _envs;
        if (!matched) return [{ matched, envs, notEnvs }, consumedNames];
        consumedNames.push(name);
      }

      for (const pattern of labelPatterns) {
        const result = await pattern(value, context, envs, notEnvs);
        const [matched, name, _envs, _notEnvs] = result;
        envs = _envs;
        notEnvs = _notEnvs;
        consumedNames.push(name);
        if (!matched) return [{ matched, envs, notEnvs }, consumedNames];
      }

      for (const pattern of assignPatterns) {
        const [matched, name, _envs] = await pattern(value, context, envs);
        envs = _envs;
        if (!matched) return [{ matched, envs, notEnvs }, consumedNames];
        consumedNames.push(name);
      }

      return [{ matched: true, envs, notEnvs }, consumedNames];
    };

    if (spreadPattern) {
      const compiledSpreadPattern = _compilePattern(
        spreadPattern.children[0],
        context,
        flags
      );

      return async (value, context, envs, notEnvs) => {
        if (!isRecord(value)) return { matched: false, envs, notEnvs };
        const [_result, consumedNames] = await compiledKeyPatterns(
          value,
          context,
          envs,
          notEnvs
        );
        if (!_result.matched) return _result;
        envs = _result.envs;
        notEnvs = _result.notEnvs;

        const rest = recordOmit(value, consumedNames);
        const result = await compiledSpreadPattern(
          rest,
          context,
          envs,
          notEnvs
        );
        envs = mergePatternTestEnvs(envs, result.envs);
        if (!result.matched) return { matched: false, envs, notEnvs };

        return { matched: true, envs, notEnvs };
      };
    }

    return async (value, context, envs, notEnvs) => {
      if (!isRecord(value)) return { matched: false, envs, notEnvs };
      const [result] = await compiledKeyPatterns(value, context, envs, notEnvs);
      return result;
    };
  }

  const invalidPatternError = SystemError.invalidPattern(
    getPosition(patternAst)
  ).withFileId(context.fileId);
  unreachable(invalidPatternError);
};

export const bind = (envs: PatternTestEnvs, context: EvalContext) => {
  const readonly = new Map();
  const mutable = new Map();

  for (const [key, value] of envs.readonly.entries()) {
    const _key = typeof key === 'string' ? key : key[0];

    if (value === null) continue;
    if (context.env.hasReadonly(_key)) readonly.set(_key, value);
    else if (context.env.has(_key)) readonly.set(_key, value);
    else context.env.addReadonly(_key, value);
  }
  for (const [key, value] of envs.env.entries()) {
    const _key = typeof key === 'string' ? key : key[0];

    if (value === null) continue;
    if (context.env.hasReadonly(_key)) mutable.set(_key, value);
    else if (context.env.has(_key)) mutable.set(_key, value);
    else context.env.add(_key, value);
  }

  // spill redeclared names to forked environment
  if (readonly.size > 0 || mutable.size > 0) {
    context.env = new Environment({ parent: context.env, mutable, readonly });
  }

  assert(
    envs.exports.size === 0,
    'cant do exports not at the top level of a module'
  );
};

export const bindContext = (
  envs: PatternTestEnvs,
  context: EvalContext
): EvalContext => {
  const forked = forkContext(context);
  bind(envs, forked);
  return forked;
};
