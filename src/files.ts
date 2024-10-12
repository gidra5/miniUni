import {
  evaluateModuleString,
  compileScriptString,
  newContext,
  newCompileContext,
} from './evaluate/index.js';
import { SystemError } from './error.js';
import { assert, unreachable } from './utils.js';
import { isRecord } from './values.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import { inject, Injectable } from './injector.js';
import { buffer, module, Module, script } from './module.js';

const MODULE_FILE_EXTENSION = '.unim';
const SCRIPT_FILE_EXTENSION = '.uni';
const LOCAL_DEPENDENCIES_PATH = 'dependencies';
const DIRECTORY_INDEX_FILE_NAME = 'index' + SCRIPT_FILE_EXTENSION;

type Dictionary = Record<string, Module>;

export const addFile = (fileName: string, source: string) => {
  const fileMap = inject(Injectable.FileMap);
  fileMap.addFile(fileName, source);
  return fileMap.getFileId(fileName);
};

export const modules = {} satisfies Dictionary;

export const getModule = async ({
  name,
  from,
  resolvedPath,
}: {
  name: string;
  from?: string;
  resolvedPath?: string;
}): Promise<Module> => {
  if (name.startsWith('std')) {
    const module = await import('./std/index.js');
    const submodule = name.split('/')[1];
    if (submodule in module) {
      return module[submodule];
    }
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
    const compileContext = newCompileContext(fileId, resolvedPath!);
    const context = newContext();

    if (isModule) {
      const _module = await evaluateModuleString(
        source,
        compileContext,
        context
      );
      assert(isRecord(_module), 'expected module to be a record');
      return module(_module);
    }
    if (isScript) {
      const compiled = compileScriptString(source, compileContext);
      const result = await compiled(context);
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
export async function resolvePath(
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
