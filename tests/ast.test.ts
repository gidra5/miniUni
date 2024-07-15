import { expect, it } from 'vitest';
import { describe } from 'node:test';
import { parseTokens } from '../src/tokens.ts';
import { parseScript } from '../src/parser.ts';

const examples = [
  {
    name: 'advent of code 2023, day 1',
    file: 'examples/example.uni',
    expected: 142,
  },
];

describe('ast', () => {
  it('ast 1', () => {
    const input = `
      // https://adventofcode.com/2023/day/1

      /* take first and last digit on line, concat into two-digit number
       * and sum all numbers in document
       */
      document := "
        1abc2
        pqr3stu8vwx
        a1b2c3d4e5f
        treb7uchet
      "
    `;
    const tokens = parseTokens(input);
    const ast = parseScript(tokens);

    // console.dir(tokens, { depth: null });
    // console.dir(ast, { depth: null });

    expect(ast).toMatchSnapshot();
  });
});
