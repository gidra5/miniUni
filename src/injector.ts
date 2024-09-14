import { FileMap } from 'codespan-napi';
import { Precedence } from './ast';

enum Injectable {
  FileMap = 'FileMap',
  RootDir = 'RootDir',
  ASTNodeNextId = 'ASTNodeNextId',
  ASTNodePrecedenceMap = 'ASTNodePrecedenceMap',
}

type InjectableType = {
  [Injectable.FileMap]: FileMap;
  [Injectable.RootDir]: string;
  [Injectable.ASTNodeNextId]: number;
  [Injectable.ASTNodePrecedenceMap]: Map<string, Precedence>;
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
register(Injectable.ASTNodeNextId, 0);
register(Injectable.ASTNodePrecedenceMap, new Map());

export { register, inject, Injectable };
