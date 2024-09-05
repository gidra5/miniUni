import {
  AbstractSyntaxTree,
  implicitPlaceholder,
  NodeType,
  OperatorType,
} from './parser.js';
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

  if (ast.type === NodeType.OPERATOR) {
    if (ast.data.operator === OperatorType.APPLICATION) {
      const [lhs, rhs] = ast.children;

      assert(lhs !== undefined, 'expected lhs in application node');
      assert(rhs !== undefined, 'expected rhs in application node');

      if (lhs.type === NodeType.NUMBER || lhs.type === NodeType.STRING) {
        errors.push(
          SystemError.evaluationError(
            'Cannot apply a number or string as a function',
            [],
            lhs.data.position
          ).withFileId(fileId)
        );
        errored = true;
        ast.children[0] = implicitPlaceholder(lhs.data.position);
      }
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
