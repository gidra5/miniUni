import { expect, it } from 'vitest';
import { getModule } from '../src/files.ts';
import path from 'path';
import { assert } from '../src/utils.ts';

// TODO: better root handling
const examples = [
  {
    root: path.resolve('./examples/advent_of_code_1_modules/index.uni'),
    name: 'advent of code 2023, day 1, modules',
    file: './',
    expected: 142,
  },
  {
    root: path.resolve('./examples/advent_of_code_1_single.uni'),
    name: 'advent of code 2023, day 1, single script, list iteration',
    file: './advent_of_code_1_single.uni',
    expected: 142,
  },
  {
    root: path.resolve('./examples/advent_of_code_1_channels.uni'),
    name: 'advent of code 2023, day 1, single script, channels',
    file: './advent_of_code_1_channels.uni',
    expected: 142,
  },
];

for (const { root, name, file, expected } of examples) {
  it(name, async () => {
    const module = await getModule(file, root);
    assert('script' in module, 'expected script');
    expect(module.script).toEqual(expected);
  });
}
