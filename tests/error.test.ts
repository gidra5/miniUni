import { beforeEach, expect, it } from 'vitest';
import { describe } from 'node:test';
import { parseTokens } from '../src/tokens.ts';
import { parseScript } from '../src/parser.ts';
import { validate } from '../src/validate.ts';
import { addFile } from '../src/files.ts';

describe('ast', () => {
  it('ast parens multiline', async () => {
    const input = `(
      1 +
      2
      + 3
    )`;
    const fileId = addFile('<test>', input);
    const tokens = parseTokens(input);
    const ast = parseScript(tokens);
    const [errors, validated] = validate(ast, fileId);

    for (const error of errors) {
      expect(error.fileId).toEqual(fileId);
    }

    expect(errors.map((e) => e.toObject())).toMatchSnapshot();
    expect(validated).toMatchSnapshot();
  });
});
