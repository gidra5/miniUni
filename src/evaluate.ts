import { Diagnostic, primaryDiagnosticLabel } from 'codespan-napi';
import { SystemError } from './error.js';
import {
  getModule,
  listMethods,
  ModuleDefault,
  prelude,
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
} from './ast.js';
import { parseTokens } from './tokens.js';
import {
  assert,
  getClosestName,
  inspect,
  isEqual,
  omit,
  unreachable,
} from './utils.js';
import {
  atom,
  awaitTask,
  createTask,
  EvalFunction,
  EvalValue,
  getChannel,
  isChannel,
  isRecord,
  isSymbol,
  isTask,
  receive,
  send,
  tryReceive,
} from './values.js';
import { validate } from './validate.js';
import { inject, Injectable, register } from './injector.js';
import path from 'path';

type Environment = Record<string, EvalValue>;

export type Context = {
  file: string;
  fileId: number;
  readonly: Environment;
  env: Environment;
  handlers: Record<string | symbol, EvalValue>;
};

const forkEnv = (env: Context['env']): Context['env'] => {
  const forked: Context['env'] = {};
  Object.setPrototypeOf(forked, env);
  return forked;
};
const forkContext = (context: Context): Context => {
  return {
    ...context,
    env: forkEnv(context.env),
    readonly: forkEnv(context.readonly),
  };
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
  return {
    file,
    fileId,
    readonly: forkEnv(prelude),
    env: forkEnv(prelude),
    handlers: {},
  };
};

type PatternTestEnvs = {
  env: Environment;
  readonly: Environment;
  exports: Environment;
};
type PatternTestResult = {
  matched: boolean;
  envs: PatternTestEnvs;
};
type PatternTestFlags = {
  mutable: boolean; // bound names should be marked as mutable
  export: boolean; // bound names should be marked as exported
  strict: boolean; // strict matching, do not report match if value is null
};

const mergePatternTestResult = (
  a: PatternTestResult,
  b: PatternTestResult
): PatternTestResult => {
  return {
    matched: a.matched && b.matched,
    envs: {
      env: { ...a.envs.env, ...b.envs.env },
      readonly: { ...a.envs.readonly, ...b.envs.readonly },
      exports: { ...a.envs.exports, ...b.envs.exports },
    },
  };
};

const testPattern = async (
  patternAst: Tree,
  value: EvalValue,
  context: Readonly<Context>,
  envs: PatternTestEnvs = { env: {}, readonly: {}, exports: {} },
  flags: PatternTestFlags = { mutable: false, export: false, strict: true }
): Promise<PatternTestResult> => {
  // inspect({
  //   patternAst,
  //   value,
  //   envs,
  // });

  if (patternAst.type === NodeType.PLACEHOLDER) {
    return { matched: true, envs };
  }
  if (patternAst.type === NodeType.IMPLICIT_PLACEHOLDER) {
    return { matched: true, envs };
  }

  if (patternAst.type === NodeType.PARENS) {
    return await testPattern(
      patternAst.children[0],
      value,
      context,
      envs,
      flags
    );
  }

  if (patternAst.type === NodeType.NUMBER) {
    if (typeof value !== 'number') return { matched: false, envs };
    return { matched: value === patternAst.data.value, envs };
  }

  if (patternAst.type === NodeType.STRING) {
    if (typeof value !== 'string') return { matched: false, envs };
    return { matched: value === patternAst.data.value, envs };
  }

  if (patternAst.type === NodeType.ATOM) {
    if (!isSymbol(value)) return { matched: false, envs };
    return {
      matched: value.symbol === atom(patternAst.data.name).symbol,
      envs,
    };
  }

  if (patternAst.type === NodeType.PIN) {
    const _value = await evaluateExpr(patternAst.children[0], context);
    return { matched: isEqual(_value, value), envs };
  }

  if (patternAst.type === NodeType.ASSIGN) {
    const pattern = patternAst.children[0];
    const result = await testPattern(pattern, value, context, envs, flags);
    // inspect({
    //   tag: 'testPattern assign',
    //   result,
    //   value,
    //   pattern,
    // });
    if (!result.matched) {
      const _value = await evaluateExpr(patternAst.children[1], context);
      const _result = await testPattern(pattern, _value, context, envs, flags);
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
    const result = await testPattern(pattern, value, context, envs, flags);
    const bindResult = await testPattern(
      bindPattern,
      value,
      context,
      envs,
      flags
    );
    return mergePatternTestResult(result, bindResult);
  }

  if (patternAst.type === NodeType.EXPORT) {
    return await testPattern(patternAst.children[0], value, context, envs, {
      ...flags,
      export: true,
    });
  }

  if (patternAst.type === NodeType.MUTABLE) {
    return await testPattern(patternAst.children[0], value, context, envs, {
      ...flags,
      mutable: true,
    });
  }

  if (patternAst.type === NodeType.LIKE) {
    return await testPattern(patternAst.children[0], value, context, envs, {
      ...flags,
      strict: false,
    });
  }

  if (patternAst.type === NodeType.STRICT) {
    return await testPattern(patternAst.children[0], value, context, envs, {
      ...flags,
      strict: true,
    });
  }

  if (patternAst.type === NodeType.TUPLE) {
    if (!Array.isArray(value)) return { matched: false, envs };

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
          flags
        );
        Object.assign(envs.env, result.envs.env);
        Object.assign(envs.readonly, result.envs.readonly);
        continue;
      } else {
        const v = value[consumed++] ?? null;
        const result = await testPattern(pattern, v, context, envs, flags);
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
        Object.assign(envs.env, result.envs.env);
        Object.assign(envs.readonly, result.envs.readonly);
        if (!result.matched) return { matched: false, envs };
        // if (flags.strict && v === null) return { matched: false, envs };
        // if (flags.strict && value.length < consumed)
        //   return { matched: false, envs };
        continue;
      }
    }

    return { matched: true, envs };
  }

  if (patternAst.type === NodeType.RECORD) {
    if (!isRecord(value)) return { matched: false, envs };

    const record = value.record;
    const patterns = patternAst.children;
    const consumedNames: string[] = [];

    for (const pattern of patterns) {
      if (pattern.type === NodeType.NAME) {
        const name = pattern.data.value;
        const value = record[name] ?? null;
        if (value === null && flags.strict) return { matched: false, envs };
        if (value !== null) {
          if (flags.mutable) envs.env[name] = value;
          if (flags.export) envs.exports[name] = value;
          else envs.readonly[name] = value;
        }
        consumedNames.push(name);
        continue;
      } else if (pattern.type === NodeType.LABEL) {
        const [key, valuePattern] = pattern.children;
        const name =
          key.type === NodeType.SQUARE_BRACKETS
            ? await evaluateExpr(key.children[0], context)
            : key.type === NodeType.NAME
            ? key.data.value
            : null;
        if (name === null) return { matched: false, envs };
        const value = record[isSymbol(name) ? name.symbol : name] ?? null;
        if (value === null && flags.strict) return { matched: false, envs };
        consumedNames.push(name);
        const result = await testPattern(
          valuePattern,
          value,
          context,
          envs,
          flags
        );
        Object.assign(envs.env, result.envs.env);
        Object.assign(envs.readonly, result.envs.readonly);
        if (!result.matched) return { matched: false, envs };
        continue;
      } else if (pattern.type === NodeType.SPREAD) {
        const rest = omit(record, consumedNames);
        const result = await testPattern(
          pattern.children[0],
          { record: rest },
          context,
          envs,
          flags
        );
        Object.assign(envs.env, result.envs.env);
        Object.assign(envs.readonly, result.envs.readonly);
        if (!result.matched) return { matched: false, envs };
        continue;
      } else if (pattern.type === NodeType.ASSIGN) {
        const _pattern = pattern.children[0];
        assert(_pattern.type === NodeType.NAME, 'expected name');
        const name = _pattern.data.value;
        const value =
          record[name] ?? (await evaluateExpr(pattern.children[1], context));

        if (value === null && flags.strict) return { matched: false, envs };
        if (value !== null) {
          if (flags.mutable) envs.env[name] = value;
          else if (flags.export) envs.exports[name] = value;
          else envs.readonly[name] = value;
        }
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

    return { matched: true, envs };
  }

  if (patternAst.type === NodeType.NAME) {
    const name = patternAst.data.value;
    if (value === null && flags.strict) return { matched: false, envs };
    if (value !== null) {
      if (flags.mutable) envs.env[name] = value;
      else if (flags.export) envs.exports[name] = value;
      else envs.readonly[name] = value;
    }
    return { matched: true, envs };
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
  if (patternAst.type === NodeType.INDEX) {
    assert(
      typeof value === 'number',
      SystemError.invalidIncrementValue(getPosition(patternAst)).withFileId(
        context.fileId
      )
    );
    const [list, index] = await Promise.all(
      patternAst.children.map((child) => evaluateExpr(child, context))
    );
    assert(
      Array.isArray(list),
      SystemError.invalidIndexTarget(getPosition(patternAst)).withFileId(
        context.fileId
      )
    );
    assert(
      Number.isInteger(index),
      SystemError.invalidIndex(getPosition(patternAst)).withFileId(
        context.fileId
      )
    );
    assert(typeof index === 'number');
    const v = list[index];
    assert(
      typeof v === 'number',
      SystemError.invalidIncrement(
        index.toString(),
        getPosition(patternAst)
      ).withFileId(context.fileId)
    );
    list[index] = value;
    return context;
  }

  const { matched, envs } = await testPattern(patternAst, value, context);
  assert(matched, 'expected pattern to match');

  assert(
    Object.keys(envs.exports).length === 0,
    'cant do exports at increment'
  );
  assert(
    Object.keys(envs.env).length === 0,
    'cant do mutable declarations at increment'
  );

  // inspect({
  //   tag: 'assign',
  //   matched,
  //   envs,
  //   context,
  // });

  for (const name in envs.readonly) {
    assert(!(name in context.readonly), 'expected mutable name');
    assert(
      name in context.env,
      SystemError.invalidAssignment(
        name,
        getPosition(patternAst),
        getClosestName(name, Object.keys(context.env))
      ).withFileId(context.fileId)
    );
    const v = context.env[name];
    assert(
      typeof v === 'number',
      SystemError.invalidIncrement(name, getPosition(patternAst)).withFileId(
        context.fileId
      )
    );
    const value = envs.readonly[name];
    assert(
      typeof value === 'number',
      SystemError.invalidIncrement(name, getPosition(patternAst)).withFileId(
        context.fileId
      )
    );
    const enclosing = Object.getPrototypeOf(context.env);
    if (name in enclosing) {
      await incAssign(patternAst, value, { ...context, env: enclosing });
    } else context.env[name] = v + value;
    return context;
  }

  // inspect({
  //   tag: 'assign 2',
  //   matched,
  //   envs,
  //   context,
  // });

  return context;

  unreachable(
    SystemError.invalidPattern(getPosition(patternAst)).withFileId(
      context.fileId
    )
  );
};

const assign = async (
  patternAst: Tree,
  value: EvalValue,
  context: Context
): Promise<Context> => {
  if (patternAst.type === NodeType.INDEX) {
    const [list, index] = await Promise.all(
      patternAst.children.map((child) => evaluateExpr(child, context))
    );
    assert(
      Array.isArray(list),
      SystemError.invalidIndexTarget(getPosition(patternAst)).withFileId(
        context.fileId
      )
    );
    assert(
      Number.isInteger(index),
      SystemError.invalidIndex(getPosition(patternAst)).withFileId(
        context.fileId
      )
    );
    assert(typeof index === 'number');
    assert(value !== null, 'expected value');
    list[index] = value;
    return context;
  }

  const { matched, envs } = await testPattern(patternAst, value, context);
  assert(matched, 'expected pattern to match');

  assert(
    Object.keys(envs.exports).length === 0,
    'cant do exports in at assignment'
  );
  assert(
    Object.keys(envs.env).length === 0,
    'cant do mutable declarations at assignment'
  );

  // inspect({
  //   tag: 'assign',
  //   matched,
  //   envs,
  //   context,
  // });

  for (const name in envs.readonly) {
    assert(!(name in context.readonly), 'expected mutable name');
    assert(
      name in context.env,
      SystemError.invalidAssignment(
        name,
        getPosition(patternAst),
        getClosestName(name, Object.keys(context.env))
      ).withFileId(context.fileId)
    );

    const value = envs.readonly[name];
    const enclosing = Object.getPrototypeOf(context.env);
    if (value === null) delete context.env[name];
    else if (name in enclosing) {
      await assign(patternAst, value, { ...context, env: enclosing });
    } else context.env[name] = value;
  }

  // inspect({
  //   tag: 'assign 2',
  //   matched,
  //   envs,
  //   context,
  // });

  return context;
};

const bind = async (
  patternAst: Tree,
  value: EvalValue,
  context: Context
): Promise<Context> => {
  const { matched, envs } = await testPattern(patternAst, value, context);

  assert(matched, 'expected pattern to match');

  Object.assign(context.env, envs.env);
  Object.assign(context.readonly, envs.readonly);

  assert(Object.keys(envs.exports).length === 0, 'cant do exports in scripts');

  return context;
};

async function bindExport(
  patternAst: Tree,
  value: EvalValue,
  exports: Record<string, EvalValue>,
  context: Context
): Promise<Record<string, EvalValue>> {
  const { matched, envs } = await testPattern(patternAst, value, context);

  assert(matched, 'expected pattern to match');

  Object.assign(context.env, envs.env);
  Object.assign(context.readonly, envs.readonly);
  Object.assign(context.readonly, envs.exports);
  Object.assign(exports, envs.exports);

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
      typeof sum === 'number' || typeof sum === 'string',
      'expected number or string on lhs'
    );
    for (const v of rest) {
      assert(
        typeof v === typeof sum,
        'expected number or string on both lhs and rhs'
      );
      sum += v as string;
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
    if (isSymbol(left) && isSymbol(right)) {
      return left.symbol === right.symbol;
    } else if (isChannel(left) && isChannel(right)) {
      return left.channel === right.channel;
    } else if (isRecord(left) && isRecord(right)) {
      return left.record === right.record;
    } else return left === right;
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
    if (isRecord(value) && isSymbol(key)) {
      return key.symbol in value.record;
    }
    if (isRecord(value) && typeof key === 'string') {
      return key in value.record;
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

    const handlers = { ...context.handlers, ...value.record };
    Object.setPrototypeOf(handlers, context.handlers);
    return await evaluateBlock(body, { ...context, handlers });
  },
  [NodeType.WITHOUT]: async ([expr, body]: Tree[], context: Context) => {
    let value = await evaluateExpr(expr, context);
    if (!Array.isArray(value)) value = [value];
    assert(
      value.every((v) => typeof v === 'string' || isSymbol(v)),
      'expected strings or symbols'
    );

    const handlerNames = value.map((v) => (isSymbol(v) ? v.symbol : v));
    const handlers = omitHandlers(context.handlers, handlerNames);
    return await evaluateBlock(body, { ...context, handlers });
  },
  [NodeType.MASK]: async ([expr, body]: Tree[], context: Context) => {
    let value = await evaluateExpr(expr, context);
    if (!Array.isArray(value)) value = [value];
    assert(
      value.every((v) => typeof v === 'string' || isSymbol(v)),
      'expected strings or symbols'
    );

    const handlerNames = value.map((v) => (isSymbol(v) ? v.symbol : v));
    const handlers = maskHandlers(context.handlers, handlerNames);
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
        Object.assign(forked.env, result.envs.env);
        Object.assign(forked.readonly, result.envs.readonly);
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

      if (result.matched) {
        const forked = forkContext(context);
        Object.assign(forked.env, result.envs.env);
        Object.assign(forked.readonly, result.envs.readonly);
        return await evaluateBlock(trueBranch, forked);
      } else return await evaluateBlock(falseBranch, context);
    }
    const result = await evaluateExpr(condition, context);
    // inspect({
    //   tag: 'evaluateExpr if else 2',
    //   result,
    //   condition,
    //   context,
    // });
    if (result) return await evaluateBlock(trueBranch, context);
    else return await evaluateBlock(falseBranch, context);
  },
  [NodeType.WHILE]: async ([condition, body]: Tree[], context: Context) => {
    while (true) {
      const _context = forkContext(context);
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

    const mapped: EvalValue[] = [];
    for (const item of list) {
      const _context = forkContext(context);
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
  },
  [NodeType.LOOP]: async ([body]: Tree[], context: Context) => {
    if (body.type === NodeType.BLOCK) {
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
  },

  [NodeType.BLOCK]: async ([expr]: Tree[], context: Context) => {
    try {
      return await evaluateBlock(expr, context);
    } catch (e) {
      if (typeof e === 'object' && e !== null && 'break' in e)
        return e.break as EvalValue;
      else throw e;
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
    await bind(pattern, value, context);
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

    return { record: { [key]: value } };
  },
  [NodeType.TUPLE]: async (children: Tree[], context: Context) => {
    const list: EvalValue[] = [];
    const record = {};

    for (const child of children) {
      if (child.type === NodeType.SPREAD) {
        const rest = await evaluateExpr(child.children[0], context);
        if (Array.isArray(rest)) list.push(...rest);
        else if (isRecord(rest)) Object.assign(record, rest.record);
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
        record[key] = value;
      } else if (child.type === NodeType.IMPLICIT_PLACEHOLDER) continue;
      else list.push(await evaluateExpr(child, context));
    }

    if (Object.keys(record).length > 0) {
      Object.assign(record, list);
      // inspect({
      //   tag: 'evaluateExpr tuple record',
      //   record,
      //   children,
      //   context,
      // });

      return { record };
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
      return target[index as number];
    } else if (isRecord(target)) {
      const record = target.record;
      assert(
        typeof index === 'string',
        SystemError.invalidIndex(getPosition(_index)).withFileId(context.fileId)
      );
      return record[index];
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
      assert(!Buffer.isBuffer(module), 'binary file import is not supported');
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

    case NodeType.SEND: {
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

      const channel = getChannel(channelValue.channel);

      assert(
        channel,
        SystemError.channelClosed(getPosition(ast)).withFileId(context.fileId)
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
    case NodeType.RECEIVE: {
      const channelValue = await evaluateExpr(ast.children[0], context);

      assert(
        isChannel(channelValue),
        SystemError.invalidReceiveChannel(getPosition(ast)).withFileId(
          context.fileId
        )
      );

      return receive(channelValue.channel).catch((e) => {
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

      const status = send(channelValue.channel, value);
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

      const [value, status] = tryReceive(channelValue.channel);

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

      const self: EvalFunction = async (arg, [, , callerContext]) => {
        const _context = forkContext(context);
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

      return await fnValue(argValue, [
        getPosition(ast),
        context.fileId,
        context,
      ]);
    }

    case NodeType.SPREAD: {
      unreachable(
        SystemError.invalidUseOfSpread(getPosition(ast)).withFileId(
          context.fileId
        )
      );
    }

    case NodeType.ATOM: {
      return atom(ast.data.name);
    }

    case NodeType.NAME:
      const name = ast.data.value;
      if (name === 'true') return true;
      if (name === 'false') return false;
      if (name === 'injected') return { record: context.handlers };
      assert(
        name in context.env || name in context.readonly,
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
      return context.readonly[name] ?? context.env[name];
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
): Promise<Extract<EvalValue, { record: unknown }>> => {
  assert(ast.type === NodeType.MODULE, 'expected module');
  const record: Record<string | symbol, EvalValue> = {};

  for (const child of ast.children) {
    if (child.type === NodeType.EXPORT) {
      const exportNode = child.children[0];

      if (exportNode.type === NodeType.DECLARE) {
        const [name, expr] = exportNode.children;
        const value = await evaluateExpr(expr, context);
        await bindExport(name, value, record, context);
        await bind(name, value, context);
      } else {
        const value = await evaluateExpr(exportNode, context);

        assert(
          !(ModuleDefault in record),
          SystemError.duplicateDefaultExport(
            getPosition(exportNode)
          ).withFileId(context.fileId)
        );

        record[ModuleDefault] = value;
      }
    } else {
      await evaluateStatement(child, context);
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
