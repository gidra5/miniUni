import { FileMap } from 'codespan-napi';
import {
  evaluateModuleString,
  evaluateScriptString,
  newContext,
} from './evaluate.js';
import { SystemError } from './error.js';
import { assert, inspect, unreachable } from './utils.js';
import { EvalValue, fn, isRecord, receive } from './values.js';
import path from 'path';
import fs from 'fs/promises';

const MODULE_FILE_EXTENSION = '.unim';
const SCRIPT_FILE_EXTENSION = '.uni';
const LOCAL_DEPENDENCIES_PATH = 'dependencies';

export const Prelude = Symbol('Prelude');
export const ScriptResult = Symbol('ScriptResult');

type Module =
  | Record<string, EvalValue>
  | { [ScriptResult]: EvalValue }
  | Buffer;

export const fileMap = new FileMap();

export const addFile = (fileName: string, source: string) => {
  fileMap.addFile(fileName, source);
  return fileMap.getFileId(fileName);
};

export const prelude: Record<string, EvalValue> = {
  channel: fn(1, () => {
    const channel = Symbol();
    return { channel };
  }),
  length: fn(1, ([position, fileId], list) => {
    const lengthErrorFactory = SystemError.invalidArgumentType(
      'length',
      { args: [['list', 'list _']], returns: 'number' },
      position
    );
    assert(Array.isArray(list), lengthErrorFactory(0).withFileId(fileId));
    return list.length;
  }),
  number: fn(1, (_, n) => {
    return Number(n);
  }),
  print: fn(1, (_, value) => {
    console.log(value);
    return value;
  }),
  return: fn(1, (_, value) => {
    throw { return: value };
  }),
};

export const modules = {
  'std/math': {
    floor: fn(1, ([position, fileId], n) => {
      const floorErrorFactory = SystemError.invalidArgumentType(
        'floor',
        { args: [['target', 'number']], returns: 'number' },
        position
      );
      assert(typeof n === 'number', floorErrorFactory(0).withFileId(fileId));
      return Math.floor(n);
    }),
  },
  'std/string': {
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
    slice: fn(1, ([position, fileId], args) => {
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
      const [item, start, end] = args;

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
  },
  'std/concurrency': {
    all: fn(1, async ([position, fileId], list) => {
      const allErrorFactory = SystemError.invalidArgumentType(
        'all',
        {
          args: [['target', 'list (channel a)']],
          returns: 'list a',
        },
        position
      );
      assert(Array.isArray(list), allErrorFactory(0).withFileId(fileId));
      const x = list.map(receive);
      const y = await Promise.all(x);

      return y;
    }),
  },
};

let root = process.cwd();

export const setRootDirectory = (_root: string) => {
  root = _root;
};

export const isScript = (module: Module) => {
  return ScriptResult in module;
};

export const getScriptResult = (module: Module) => {
  return module[ScriptResult];
};

export const getModule = async (
  name: string,
  from: string,
  resolvedPath = resolvePath(name, from)
): Promise<Module> => {
  if (name.startsWith('std') && name in modules) {
    return modules[name];
  }
  if (resolvedPath in modules) {
    return modules[resolvedPath];
  }

  const file = await fs.readFile(resolvedPath).catch((e) => {
    const fileId = fileMap.getFileId(from);
    const error = SystemError.importFailed(name, resolvedPath, e).withFileId(
      fileId
    );
    error.print();
    throw error;
  });
  const isModule = resolvedPath.endsWith(MODULE_FILE_EXTENSION);
  const isScript = resolvedPath.endsWith(SCRIPT_FILE_EXTENSION);

  async function loadFile(): Promise<Module> {
    if (!isModule && !isScript) return file;

    const source = file.toString('utf-8');
    const fileId = addFile(resolvedPath, source);
    const context = newContext(fileId, resolvedPath);

    if (isModule) {
      const module = await evaluateModuleString(source, context);
      assert(isRecord(module), 'expected module to be a record');
      return module.record;
    }
    if (isScript) {
      const result = await evaluateScriptString(source, context);
      const module = { [ScriptResult]: result };
      return module;
    }

    unreachable('unknown file type');
  }

  const module = await loadFile();
  modules[resolvedPath] = module;
  return module;
};

/**
 * resolve module name to an absolute path
 * @param name name being imported
 * @param from absolute path of the file that is importing the module
 * @param root absolute path of the project's root directory
 * @returns resolved absolute path of the module
 */
function resolvePath(name: string, from: string): string {
  from = path.dirname(from);
  if (name.startsWith('./')) {
    // limit the path to the project's directory
    // so that the user can't accidentally access files outside of the project
    const _path = path.resolve(from, name);
    if (root.startsWith(_path)) {
      return root;
    }
    return _path;
  }

  if (name.startsWith('/')) {
    return path.join(root, name.slice(1));
  }

  return path.join(root, '..', LOCAL_DEPENDENCIES_PATH, name);
}
