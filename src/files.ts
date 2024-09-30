import {
  Context,
  evaluateModuleString,
  evaluateScriptString,
  newContext,
} from './evaluate/index.js';
import { SystemError } from './error.js';
import { assert, inspect, unreachable } from './utils.js';
import {
  atom,
  awaitTask,
  cancelTask,
  closeChannel,
  createChannel,
  createEffect,
  createHandler,
  createRecord,
  createSet,
  EvalRecord,
  EvalValue,
  fileHandle,
  fn,
  fnPromise,
  isChannel,
  isRecord,
  isTask,
  recordGet,
} from './values.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import { inject, Injectable } from './injector.js';
import { environmentGet, newEnvironment, newHandlers } from './environment.js';

const MODULE_FILE_EXTENSION = '.unim';
const SCRIPT_FILE_EXTENSION = '.uni';
const LOCAL_DEPENDENCIES_PATH = 'dependencies';
const DIRECTORY_INDEX_FILE_NAME = 'index' + SCRIPT_FILE_EXTENSION;

type Module =
  | { module: EvalRecord; default?: EvalValue }
  | { script: EvalValue }
  | { buffer: Buffer };

type Dictionary = Record<string, Module>;

export const ModuleDefault = Symbol('module default');

const module = (module: EvalRecord | Record<string, EvalValue>): Module => {
  module = module instanceof Map ? module : createRecord(module);
  return { module, default: recordGet(module, ModuleDefault) };
};
const script = (value: EvalValue): Module => ({ script: value });
const buffer = (value: Buffer): Module => ({ buffer: value });

export const addFile = (fileName: string, source: string) => {
  const fileMap = inject(Injectable.FileMap);
  fileMap.addFile(fileName, source);
  return fileMap.getFileId(fileName);
};

export const ReturnHandler = Symbol('return_handler');
export const prelude: Context['env'] = newEnvironment({
  return_handler: ReturnHandler,
  handle: fn(2, (callSite, effect, value) => {
    return createEffect(effect, value);
  }),
  handler: async (_, handler) => {
    assert(typeof handler === 'function', 'expected function');
    return createHandler(handler);
  },
  cancel: async ([position, context], value) => {
    const fileId = context.fileId;
    const cancelErrorFactory = SystemError.invalidArgumentType(
      'cancel',
      { args: [['target', 'task _']], returns: 'void' },
      position
    );
    assert(isTask(value), cancelErrorFactory(0).withFileId(fileId));
    return cancelTask(value);
  },
  channel: fn(1, (_, name) => {
    if (typeof name === 'string') return createChannel(name);
    else return createChannel();
  }),
  close: fn(1, ([position, context], value) => {
    const fileId = context.fileId;
    const closeErrorFactory = SystemError.invalidArgumentType(
      'cancel',
      { args: [['target', 'channel _']], returns: 'void' },
      position
    );
    assert(value !== null, closeErrorFactory(0).withFileId(fileId));
    assert(isChannel(value), closeErrorFactory(0).withFileId(fileId));
    closeChannel(value);
    return null;
  }),
  symbol: fn(1, (_, name) => {
    if (typeof name === 'string') return Symbol(name);
    else return Symbol();
  }),
  length: fn(1, ([position, context], list) => {
    const fileId = context.fileId;
    const lengthErrorFactory = SystemError.invalidArgumentType(
      'length',
      { args: [['list', 'list _ | string']], returns: 'number' },
      position
    );
    assert(
      Array.isArray(list) || typeof list === 'string',
      lengthErrorFactory(0).withFileId(fileId)
    );
    return list.length;
  }),
  number: fn(1, (_, n) => {
    return Number(n);
  }),
  string: fn(1, (_, n) => {
    return String(n);
  }),
  print: fn(1, (_, value) => {
    inspect(value);
    return value;
  }),
  return: fn(1, (_, value) => {
    return createEffect(atom('return'), value);
  }),
  break: fn(1, (_, value) => {
    return createEffect(atom('break'), value);
  }),
  continue: fn(1, (_, value) => {
    return createEffect(atom('continue'), value);
  }),
  set: fn(1, (_, value) => {
    if (!Array.isArray(value)) value = [value];
    return createSet(value);
  }),
});

export const PreludeIO = Symbol('prelude io');
export const preludeHandlers: Context['handlers'] = newHandlers({
  [PreludeIO]: createRecord({
    open: fn(2, async (cs, _path, callback) => {
      assert(typeof _path === 'string');
      const file = createRecord({
        write: fn(1, () => null),
        close: async () => null,
      });

      assert(typeof callback === 'function');
      return await fnPromise(callback)(cs, file);
    }),
  }),
  [ReturnHandler]: async (_, value) => value,
});

export const modules: Dictionary = {
  'std/math': module({
    floor: fn(1, ([position, context], n) => {
      const fileId = context.fileId;
      const floorErrorFactory = SystemError.invalidArgumentType(
        'floor',
        { args: [['target', 'number']], returns: 'number' },
        position
      );
      assert(typeof n === 'number', floorErrorFactory(0).withFileId(fileId));
      return Math.floor(n);
    }),
    sqrt: fn(1, ([position, context], n) => {
      const fileId = context.fileId;
      const sqrtErrorFactory = SystemError.invalidArgumentType(
        'sqrt',
        { args: [['target', 'number']], returns: 'number' },
        position
      );
      assert(typeof n === 'number', sqrtErrorFactory(0).withFileId(fileId));
      return Math.sqrt(n);
    }),
  }),
  'std/string': module({
    split: fn(2, ([position, context], target, separator) => {
      const fileId = context.fileId;
      const splitErrorFactory = SystemError.invalidArgumentType(
        'split',
        {
          args: [
            ['target', 'string'],
            ['separator', 'string'],
          ],
          returns: 'string[]',
        },
        position
      );

      assert(
        typeof target === 'string',
        splitErrorFactory(0).withFileId(fileId)
      );
      assert(
        typeof separator === 'string',
        splitErrorFactory(1).withFileId(fileId)
      );
      return target.split(separator);
    }),
    replace: fn(3, ([position, context], pattern, replacement, target) => {
      const fileId = context.fileId;
      const replaceErrorFactory = SystemError.invalidArgumentType(
        'replace',
        {
          args: [
            ['pattern', 'regex'],
            ['replacement', 'string'],
            ['target', 'string'],
          ],
          returns: 'string',
        },
        position
      );
      assert(
        typeof pattern === 'string',
        replaceErrorFactory(0).withFileId(fileId)
      );
      assert(
        typeof replacement === 'string',
        replaceErrorFactory(1).withFileId(fileId)
      );
      assert(
        typeof target === 'string',
        replaceErrorFactory(2).withFileId(fileId)
      );
      return target.replace(new RegExp(pattern, 'g'), replacement);
    }),
    match: fn(2, ([position, context], pattern, target) => {
      const fileId = context.fileId;
      const matchErrorFactory = SystemError.invalidArgumentType(
        'match',
        {
          args: [
            ['pattern', 'regex'],
            ['target', 'string'],
          ],
          returns: 'string',
        },
        position
      );
      assert(
        typeof pattern === 'string',
        matchErrorFactory(0).withFileId(fileId)
      );
      assert(
        typeof target === 'string',
        matchErrorFactory(1).withFileId(fileId)
      );
      return new RegExp(pattern).test(target);
    }),
    char_at: fn(2, ([position, context], target, index) => {
      const fileId = context.fileId;
      const charAtErrorFactory = SystemError.invalidArgumentType(
        'char_at',
        {
          args: [
            ['target', 'string'],
            ['index', 'integer'],
          ],
          returns: 'string',
        },
        position
      );
      assert(
        typeof target === 'string',
        charAtErrorFactory(0).withFileId(fileId)
      );
      assert(
        typeof index === 'number',
        charAtErrorFactory(1).withFileId(fileId)
      );
      return target.charAt(index);
    }),
    slice: fn(2, ([position, context], item, args) => {
      const fileId = context.fileId;
      const sliceErrorFactory = SystemError.invalidArgumentType(
        'slice',
        {
          args: [
            ['item', 'string | list a'],
            ['start', 'number?'],
            ['end', 'number?'],
          ],
          returns: 'string | list a',
        },
        position
      );
      assert(
        Array.isArray(args),
        SystemError.evaluationError(
          'slice expects tuple of arguments as argument',
          [],
          position
        ).withFileId(fileId)
      );
      const [start, end] = args;

      assert(
        typeof item === 'string' || Array.isArray(item),
        sliceErrorFactory(0).withFileId(fileId)
      );
      if (start !== undefined) {
        assert(
          typeof start === 'number',
          sliceErrorFactory(1).withFileId(fileId)
        );
      }
      if (end !== undefined) {
        assert(
          typeof end === 'number',
          sliceErrorFactory(2).withFileId(fileId)
        );
      }

      return item.slice(start, end);
    }),
  }),
  'std/iter': module({
    range: fn(2, ([position, context], start, end) => {
      const fileId = context.fileId;
      const rangeErrorFactory = SystemError.invalidArgumentType(
        'range',
        {
          args: [
            ['start', 'number'],
            ['end', 'number?'],
          ],
          returns: 'list number',
        },
        position
      );
      assert(
        typeof start === 'number',
        rangeErrorFactory(0).withFileId(fileId)
      );
      assert(typeof end === 'number', rangeErrorFactory(1).withFileId(fileId));
      const list: number[] = [];
      for (let i = start; i < end; i++) {
        list.push(i);
      }
      return list;
    }),
  }),
  'std/concurrency': module({
    all: fn(1, async ([position, context], list) => {
      const fileId = context.fileId;
      const allErrorFactory = SystemError.invalidArgumentType(
        'all',
        {
          args: [['target', 'list (task a)']],
          returns: 'list a',
        },
        position
      );
      assert(Array.isArray(list), allErrorFactory(0).withFileId(fileId));
      const x = list.map(async (task) => {
        assert(isTask(task), allErrorFactory(0).withFileId(fileId));
        return await awaitTask(task);
      });
      return (await Promise.all(x)).filter((x) => x !== null);
    }),
    some: fn(1, async ([position, context], list) => {
      const fileId = context.fileId;
      const someErrorFactory = SystemError.invalidArgumentType(
        'some',
        {
          args: [['target', 'list a']],
          returns: 'boolean',
        },
        position
      );
      assert(Array.isArray(list), someErrorFactory(0).withFileId(fileId));
      const x = list.map(async (task) => {
        assert(isTask(task), someErrorFactory(0).withFileId(fileId));
        return await awaitTask(task);
      });
      return await Promise.race(x);
    }),
    wait: fn(1, async ([position, context], time) => {
      const fileId = context.fileId;
      const waitErrorFactory = SystemError.invalidArgumentType(
        'wait',
        {
          args: [['time', 'number']],
          returns: 'void',
        },
        position
      );
      assert(typeof time === 'number', waitErrorFactory(0).withFileId(fileId));
      await new Promise((resolve) => setTimeout(resolve, time));
      return null;
    }),
  }),
  'std/io': module({
    open: fn(2, async (cs, _path, callback) => {
      const [position, context] = cs;
      const fileId = context.fileId;
      const openErrorFactory = SystemError.invalidArgumentType(
        'all',
        {
          args: [
            ['filepath', 'string'],
            ['callback', 'fileHandle -> a'],
          ],
          returns: 'a',
        },
        position
      );
      assert(typeof _path === 'string', openErrorFactory(0).withFileId(fileId));
      assert(
        typeof callback === 'function',
        openErrorFactory(1).withFileId(fileId)
      );
      assert(
        _path.startsWith('.') || _path.startsWith('/'),
        'expected path to be absolute or relative'
      );
      const resolved = await resolvePath(_path, context.file);
      const ioHandler = context.handlers.get(PreludeIO);
      assert(isRecord(ioHandler), 'expected io handler to be record');

      const file = await new Promise<EvalValue>(async (resolve) => {
        const open = recordGet(ioHandler, 'open');
        assert(typeof open === 'function', 'expected open to be a function');
        const curried = await fnPromise(open)(cs, resolved);

        assert(typeof curried === 'function', 'expected open to take callback');
        fnPromise(curried)(
          cs,
          fn(1, (_cs, file) => {
            resolve(file);
            return null;
          })
        );
      });
      assert(isRecord(file), 'expected file handle to be record');
      const close = recordGet(file, 'close');
      assert(typeof close === 'function', 'expected close to be a function');
      const result = await fnPromise(callback)(cs, fileHandle(file));
      await fnPromise(close)(cs, []);

      return result;
    }),
  }),
};

export const stringMethods = (() => {
  const strmod = modules['std/string'];
  const { module } = strmod as Extract<typeof strmod, { module: any }>;
  return {
    length: environmentGet(prelude, 'length'),
    split: recordGet(module, 'split'),
    char_at: recordGet(module, 'char_at'),
    slice: recordGet(module, 'slice'),
    replace: fn(3, async (callSite, target, pattern, replacement) => {
      const method = recordGet(module, 'replace');
      assert(typeof method === 'function', 'expected method');
      const x1 = await fnPromise(method)(callSite, pattern);
      assert(typeof x1 === 'function', 'expected method');
      const x2 = await fnPromise(x1)(callSite, replacement);
      assert(typeof x2 === 'function', 'expected method');
      return await fnPromise(x2)(callSite, target);
    }),
    match: fn(2, async (callSite, target, pattern) => {
      const method = recordGet(module, 'match');
      assert(typeof method === 'function', 'expected method');
      const x1 = await fnPromise(method)(callSite, pattern);
      assert(typeof x1 === 'function', 'expected method');
      return await fnPromise(x1)(callSite, target);
    }),
  };
})();

export const listMethods = (() => {
  const strmod = modules['std/string'];
  const { module } = strmod as Extract<typeof strmod, { module: any }>;
  return {
    slice: recordGet(module, 'slice'),
    length: environmentGet(prelude, 'length'),
    map: fn(2, async (cs, list, fn) => {
      const [pos, context] = cs;
      const fileId = context.fileId;
      const mapErrorFactory = SystemError.invalidArgumentType(
        'map',
        {
          args: [
            ['list', 'list a'],
            ['fn', 'a -> b'],
          ],
          returns: 'list b',
        },
        pos
      );
      assert(Array.isArray(list), mapErrorFactory(0).withFileId(fileId));
      assert(typeof fn === 'function', mapErrorFactory(1).withFileId(fileId));
      const mapped: EvalValue[] = [];
      for (const item of list) {
        const x = await fnPromise(fn)(cs, item);

        mapped.push(x);
      }
      return mapped;
    }),
    filter: fn(2, async (cs, list, fn) => {
      const [pos, context] = cs;
      const fileId = context.fileId;
      const filterErrorFactory = SystemError.invalidArgumentType(
        'filter',
        {
          args: [
            ['list', 'list a'],
            ['fn', 'a -> boolean'],
          ],
          returns: 'list a',
        },
        pos
      );
      assert(Array.isArray(list), filterErrorFactory(0).withFileId(fileId));
      assert(
        typeof fn === 'function',
        filterErrorFactory(1).withFileId(fileId)
      );
      const filtered: EvalValue[] = [];
      for (const item of list) {
        const x = await fnPromise(fn)(cs, item);
        if (x) filtered.push(item);
      }
      return filtered;
    }),
  };
})();

export const getModule = async ({
  name,
  from,
  resolvedPath,
}: {
  name: string;
  from?: string;
  resolvedPath?: string;
}): Promise<Module> => {
  if (name.startsWith('std') && name in modules) {
    return modules[name];
  }
  if (!resolvedPath) {
    resolvedPath = await resolvePath(name, from).catch((e) => {
      const fileMap = inject(Injectable.FileMap);
      const fileId = fileMap.getFileId(from ?? 'cli');
      const error = SystemError.unresolvedImport(name, e).withFileId(fileId);
      error.print();
      throw error;
    });
  }
  if (resolvedPath in modules) {
    return modules[resolvedPath];
  }

  const file = await fs.readFile(resolvedPath).catch((e) => {
    const fileMap = inject(Injectable.FileMap);
    const fileId = fileMap.getFileId(from ?? 'cli');
    const error = SystemError.importFailed(name, resolvedPath, e)
      .withFileId(fileId)
      .print();
    throw error;
  });
  const isModule = resolvedPath.endsWith(MODULE_FILE_EXTENSION);
  const isScript = resolvedPath.endsWith(SCRIPT_FILE_EXTENSION);

  async function loadFile(): Promise<Module> {
    if (!isModule && !isScript) return buffer(file);

    const source = file.toString('utf-8');
    const fileId = addFile(resolvedPath!, source);
    const context = newContext(fileId, resolvedPath!);

    if (isModule) {
      const _module = await evaluateModuleString(source, context);
      assert(isRecord(_module), 'expected module to be a record');
      return module(_module);
    }
    if (isScript) {
      const result = await evaluateScriptString(source, context);
      return script(result);
    }

    unreachable('unknown file type');
  }

  const _module = await loadFile();
  modules[resolvedPath] = _module;
  return _module;
};

/**
 * resolve module name to an absolute path
 * @param name name being imported
 * @param from absolute path of the file that is importing the module
 * @param _root project's root directory
 * @returns resolved absolute path of the module
 */
async function resolvePath(
  name: string,
  from?: string,
  _root = inject(Injectable.RootDir)
): Promise<string> {
  const resolve = () => {
    if (name.startsWith('.')) {
      assert(from, 'relative imports require a "from" path');
      // limit the path to the project's directory
      // so that the user can't accidentally access files outside of the project
      const dir = path.dirname(from);
      const _path = path.resolve(dir, name);
      if (_root.startsWith(_path)) return _root;
      if (!_path.startsWith(_root)) return _root;

      return _path;
    }

    if (name.startsWith('/')) {
      return path.join(_root, name.slice(1));
    }

    return path.join(_root, '..', LOCAL_DEPENDENCIES_PATH, name);
  };

  const resolved = resolve();
  const isDirectory = await fs
    .stat(resolved)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
  return isDirectory
    ? path.join(resolved, DIRECTORY_INDEX_FILE_NAME)
    : resolved;
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;

  it('resolve abs path', async () => {
    const cwd = process.cwd();
    const root = path.resolve(cwd, 'src');
    const from = path.join(root, 'one/two/three/file.uni');
    const resolved = await resolvePath('/file', from, root);
    const expected = path.join(root, 'file');
    expect(resolved).toBe(expected);
  });

  it('resolve rel path', async () => {
    const cwd = process.cwd();
    const root = path.resolve(cwd, 'src');
    const from = path.join(root, 'one/two/three/file.uni');
    const resolved = await resolvePath('./file2', from, root);
    const expected = path.join(root, 'one/two/three/file2');
    expect(resolved).toBe(expected);
  });

  it('resolve rel path 2', async () => {
    const cwd = process.cwd();
    const root = path.resolve(cwd, 'src');
    const from = path.join(root, 'one/two/three/file.uni');
    const resolved = await resolvePath('../name', from, root);
    const expected = path.join(root, 'one/two/name');
    expect(resolved).toBe(expected);
  });

  it('resolve dep path', async () => {
    const cwd = process.cwd();
    const root = path.resolve(cwd, 'src');
    const from = path.join(root, 'one/two/three/file.uni');
    const resolved = await resolvePath('file', from, root);
    const expected = path.join(root, `../${LOCAL_DEPENDENCIES_PATH}/file`);
    expect(resolved).toBe(expected);
  });

  it('resolve dir path', async () => {
    const cwd = process.cwd();
    const root = path.resolve(cwd, 'src');
    const from = path.join(root, 'one/two/three/file.uni');
    const resolved = await resolvePath('/', from, root);
    const expected = path.join(root, 'index.uni');
    expect(resolved).toBe(expected);
  });
}
