import {
  evaluateModuleString,
  evaluateScriptString,
  newContext,
} from './evaluate.js';
import { SystemError } from './error.js';
import { assert, inspect, unreachable } from './utils.js';
import {
  awaitTask,
  cancelTask,
  closeChannel,
  createChannel,
  createSet,
  EvalValue,
  fileHandle,
  fn,
  isChannel,
  isRecord,
  isTask,
  receive,
} from './values.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import { inject, Injectable } from './injector.js';

const MODULE_FILE_EXTENSION = '.unim';
const SCRIPT_FILE_EXTENSION = '.uni';
const LOCAL_DEPENDENCIES_PATH = 'dependencies';
const DIRECTORY_INDEX_FILE_NAME = 'index' + SCRIPT_FILE_EXTENSION;

type Module =
  | { module: Record<string, EvalValue>; default?: EvalValue }
  | { script: EvalValue }
  | { buffer: Buffer };

type Dictionary = Record<string, Module>;

const module = (
  entries: Record<string, EvalValue>,
  _default?: EvalValue
): Module => ({
  module: entries,
  default: _default,
});
const script = (value: EvalValue): Module => ({ script: value });
const buffer = (value: Buffer): Module => ({ buffer: value });

export const addFile = (fileName: string, source: string) => {
  const fileMap = inject(Injectable.FileMap);
  fileMap.addFile(fileName, source);
  return fileMap.getFileId(fileName);
};

export const prelude: Record<string, EvalValue> = {
  cancel: fn(1, ([position, fileId], value) => {
    const cancelErrorFactory = SystemError.invalidArgumentType(
      'cancel',
      { args: [['target', 'task _']], returns: 'void' },
      position
    );
    assert(isTask(value), cancelErrorFactory(0).withFileId(fileId));
    return cancelTask(value);
  }),
  channel: fn(1, (_, name) => {
    if (typeof name === 'string') return createChannel(name);
    else return createChannel();
  }),
  close: fn(1, ([position, fileId], value) => {
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
  length: fn(1, ([position, fileId], list) => {
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
    throw { return: value };
  }),
  set: fn(1, (_, value) => {
    if (!Array.isArray(value)) value = [value];
    return createSet(value);
  }),
};

export const PreludeIO = Symbol('prelude io');
export const preludeHandlers: Record<string | symbol, EvalValue> = {
  [PreludeIO]: {
    record: {
      open: fn(2, async (cs, _path, callback) => {
        assert(typeof _path === 'string');
        const file = {
          record: { write: fn(1, () => null), close: fn(0, () => null) },
        };

        assert(typeof callback === 'function');
        callback(file, cs);
        return null;
      }),
    },
  },
};

export const modules: Dictionary = {
  'std/math': module({
    floor: fn(1, ([position, fileId], n) => {
      const floorErrorFactory = SystemError.invalidArgumentType(
        'floor',
        { args: [['target', 'number']], returns: 'number' },
        position
      );
      assert(typeof n === 'number', floorErrorFactory(0).withFileId(fileId));
      return Math.floor(n);
    }),
  }),
  'std/string': module({
    split: fn(2, ([position, fileId], target, separator) => {
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
    replace: fn(3, ([position, fileId], pattern, replacement, target) => {
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
    match: fn(2, ([position, fileId], pattern, target) => {
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
    char_at: fn(2, ([position, fileId], target, index) => {
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
    slice: fn(2, ([position, fileId], item, args) => {
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
    range: fn(2, ([position, fileId], start, end) => {
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
    all: fn(1, async ([position, fileId], list) => {
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
    some: fn(1, async ([position, fileId], list) => {
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
    wait: fn(1, async ([position, fileId], time) => {
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
      const [position, fileId, context] = cs;
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
      const ioHandler = context.handlers[PreludeIO];
      assert(isRecord(ioHandler), 'expected io handler to be record');

      const file = await new Promise<EvalValue>(async (resolve) => {
        assert(
          typeof ioHandler.record.open === 'function',
          'expected open to be a function'
        );
        const curried = await ioHandler.record.open(resolved, cs);

        assert(typeof curried === 'function', 'expected open to take callback');
        curried(
          fn(1, (_cs, file) => {
            resolve(file);
            return null;
          }),
          cs
        );
      });
      assert(isRecord(file), 'expected file handle to be record');
      assert(
        typeof file.record.close === 'function',
        'expected close to be a function'
      );
      const result = await callback(fileHandle(file), cs);
      await file.record.close([], cs);

      return result;
    }),
  }),
};

export const stringMethods = (() => {
  const strmod = modules['std/string'];
  const { module } = strmod as Extract<typeof strmod, { module: any }>;
  return {
    length: prelude.length,
    split: module.split,
    char_at: module.char_at,
    slice: module.slice,
    replace: fn(3, async (callSite, target, pattern, replacement) => {
      const method = module.replace;
      assert(typeof method === 'function', 'expected method');
      const x1 = await method(pattern, callSite);
      assert(typeof x1 === 'function', 'expected method');
      const x2 = await x1(replacement, callSite);
      assert(typeof x2 === 'function', 'expected method');
      return await x2(target, callSite);
    }),
    match: fn(2, async (callSite, target, pattern) => {
      const method = module.match;
      assert(typeof method === 'function', 'expected method');
      const x1 = await method(pattern, callSite);
      assert(typeof x1 === 'function', 'expected method');
      return await x1(target, callSite);
    }),
  };
})();

export const listMethods = (() => {
  const strmod = modules['std/string'];
  const { module } = strmod as Extract<typeof strmod, { module: any }>;
  return {
    slice: module.slice,
    length: prelude.length,
    map: fn(2, async ([pos, fileId, context], list, fn) => {
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
        const x = await fn(item, [pos, fileId, context]);
        mapped.push(x);
      }
      return mapped;
    }),
    filter: fn(2, async ([pos, fileId, context], list, fn) => {
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
        const x = await fn(item, [pos, fileId, context]);
        if (x) filtered.push(item);
      }
      return filtered;
    }),
  };
})();

export const ModuleDefault = Symbol('module default');

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
      return module(_module.record, _module.record[ModuleDefault]);
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
