import { beforeEach, expect, it } from 'vitest';
import { getModule } from '../src/files.ts';
import path from 'path';
import { assert } from '../src/utils.ts';
import { Injectable, register } from '../src/injector.ts';
import { FileMap } from 'codespan-napi';

const examples = [
  {
    root: '/advent_of_code_1_modules',
    name: 'advent of code 2023, day 1, modules',
    file: '/',
    expected: 142,
  },
  {
    name: 'advent of code 2023, day 1, single script, list iteration',
    file: '/advent_of_code_1_single.uni',
    expected: 142,
  },
  {
    name: 'advent of code 2023, day 1, single script, channels',
    file: '/advent_of_code_1_channels.uni',
    expected: 142,
  },
  {
    root: '/advent_of_code_14',
    name: 'advent of code 2023, day 14, single script',
    file: '/index.uni',
    expected: 113456,
  },
];

beforeEach(() => {
  register(Injectable.FileMap, new FileMap());
});

for (const { root, name, file, expected } of examples) {
  it(name, async () => {
    register(Injectable.RootDir, path.resolve('./examples' + (root ?? '')));
    const module = await getModule(file);
    assert('script' in module, 'expected script');
    expect(module.script).toEqual(expected);
  });
}
