import { FileMap } from 'codespan-napi';

enum Injectable {
  FileMap = 'FileMap',
  RootDir = 'RootDir',
}

type InjectableType = {
  [Injectable.FileMap]: FileMap;
  [Injectable.RootDir]: string;
};

const registry = new Map<string, any>();

const register = <const T extends Injectable>(
  name: T,
  value: InjectableType[T]
) => {
  registry.set(name, value);
};

const inject = <const T extends Injectable>(name: T): InjectableType[T] => {
  if (!registry.has(name)) {
    throw new Error(`Missing injection entry for: ${name}`);
  }

  return registry.get(name);
};

// Register default injectables
register(Injectable.RootDir, process.cwd());
register(Injectable.FileMap, new FileMap());

export { register, inject, Injectable };
