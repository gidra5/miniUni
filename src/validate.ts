import { AbstractSyntaxTree, implicitPlaceholder, NodeType } from './parser.js';
import { SystemError } from './error.js';
import { assert } from './utils.js';

export const validate = (
  ast: AbstractSyntaxTree,
  fileId: number,
  errored = false
): [errors: SystemError[], ast: AbstractSyntaxTree] => {
  const errors: SystemError[] = [];

  if (ast.type === NodeType.ERROR) {
    errors.push(ast.data.cause.withFileId(fileId));
    errored = true;

    if (ast.children.length !== 0) {
      assert(ast.children.length === 1, 'expected one child in error node');
      ast = ast.children[0];
    } else {
      return [errors, implicitPlaceholder(ast.data.position)];
    }
  }

  for (let i = 0; i < ast.children.length; i++) {
    const node = ast.children[i];
    const [inner, child] = validate(node, fileId, errored);
    errors.push(...inner);
    ast.children[i] = child;
  }

  return [errors, ast];
};
