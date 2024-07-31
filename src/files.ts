import { FileMap } from 'codespan-napi';
import {
  Context,
  evaluateModuleString,
  evaluateScriptString,
  newContext,
} from './evaluate.js';
import { SystemError } from './error.js';
import { assert, unreachable } from './utils.js';
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
  length: fn(1, (list) => {
    assert(Array.isArray(list), SystemError.invalidLengthTarget());
    return list.length;
  }),
  number: fn(1, (n) => {
    return Number(n);
  }),
  print: fn(1, (value) => {
    console.log(value);
    return value;
  }),
  return: fn(1, (value) => {
    throw { return: value };
  }),
};

export const modules = {
  'std/math': {
    floor: fn(1, (n) => {
      assert(typeof n === 'number', SystemError.invalidFloorTarget());
      return Math.floor(n);
    }),
  },
  'std/string': {
    split: fn(2, (string, separator) => {
      assert(typeof string === 'string', SystemError.invalidSplitTarget());
      assert(
        typeof separator === 'string',
        SystemError.invalidSplitSeparator()
      );
      return string.split(separator);
    }),
    replace: fn(3, (pattern, replacement, string) => {
      assert(typeof pattern === 'string', SystemError.invalidReplacePattern());
      assert(
        typeof replacement === 'string',
        SystemError.invalidReplaceReplacement()
      );
      assert(typeof string === 'string', SystemError.invalidReplaceTarget());
      return string.replace(new RegExp(pattern, 'g'), replacement);
    }),
    match: fn(2, (pattern, string) => {
      assert(typeof pattern === 'string', SystemError.invalidMatchPattern());
      assert(typeof string === 'string', SystemError.invalidMatchTarget());
      return new RegExp(pattern).test(string);
    }),
    char_at: fn(2, (string, index) => {
      assert(typeof index === 'number', SystemError.invalidCharAtIndex());
      assert(typeof string === 'string', SystemError.invalidCharAtTarget());
      return string.charAt(index);
    }),
    slice: fn(1, (args) => {
      assert(Array.isArray(args), 'expected tuple');
      const [item, start, end] = args;

      assert(
        typeof item === 'string' || Array.isArray(item),
        'expected string or array'
      );
      assert(typeof start === 'number', 'expected start index');
      if (end !== undefined) {
        assert(typeof end === 'number', 'expected end index to be a number');
      }

      return item.slice(start, end);
    }),
  },
  'std/concurrency': {
    all: fn(1, async (list) => {
      assert(Array.isArray(list), 'invalid all target');
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
  from: string
): Promise<Module> => {
  if (name in modules) {
    return modules[name];
  }

  const resolvedPath = resolvePath(name, from);
  const file = await fs.readFile(resolvedPath).catch((e) => {
    throw SystemError.importFailed(name, resolvedPath, e);
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
  modules[name] = module;
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
  if (name.startsWith('./')) {
    // limit the path to the project's directory
    // so that the user can't accidentally access files outside of the project
    const projectFilePath = from.replace(root, '');
    return root + path.resolve(projectFilePath, name);
  }

  if (name.startsWith('/')) {
    return path.join(root, name.slice(1));
  }

  return path.join(root, '..', LOCAL_DEPENDENCIES_PATH, name);
}
