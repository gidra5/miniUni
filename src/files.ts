import { FileMap } from 'codespan-napi';

export const fileMap = new FileMap();

export const addFile = (fileName: string, source: string) => {
  fileMap.addFile(fileName, source);
  return fileMap.getFileId(fileName);
};
