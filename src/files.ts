import { FileMap } from 'codespan-napi';
import fsp from 'fs/promises';

export const map = new FileMap();

export const addFile = (fileName: string, source: string) => {
  map.addFile(fileName, source);
  return map.getFileId(fileName);
};

export const parseFile = async (path: string) => {
  const code = await fsp.readFile(path, 'utf-8');
  console.log(await evaluateScriptString(code));
};
