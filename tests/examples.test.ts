import { expect, it } from 'vitest';
import fsp from 'fs/promises';
import { evaluateScriptString as evaluate } from '../src/evaluate.ts';

const examples = [
  {
    name: 'advent of code 2023, day 1',
    file: 'examples/example.uni',
    expected: 142,
  },
];

for (const { name, file, expected } of examples) {
  it(name, async () => {
    const code = await fsp.readFile(file);
    const result = await evaluate(code.toString());
    expect(result).toEqual(expected);
  });
}
