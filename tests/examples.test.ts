import { beforeEach, expect, it } from 'vitest';
import { Injectable, register } from '../src/injector.ts';
import { FileMap } from 'codespan-napi';
import { evaluateEntryFile } from '../src/evaluate.ts';

const examples = [
  {
    name: 'advent of code 2023, day 1, modules',
    file: '/advent_of_code_1_modules/',
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
    name: 'advent of code 2023, day 14, single script',
    file: '/advent_of_code_14/index.uni',
    expected: 113456,
  },
  {
    name: 'basic hello world via script',
    file: '/hello_world.uni',
    expected: 'Hello, World!',
  },
  {
    name: 'basic hello world via module',
    file: '/hello_world_module.unim',
    expected: ['Hello, World!', []],
  },
  {
    name: 'bubble sort',
    file: '/bubble_sort.uni',
    expected: [1, 2, 2, 3, 4, 5],
  },
  {
    name: 'quick sort',
    file: '/quick_sort.uni',
    expected: [1, 2, 2, 3, 4, 5],
  },
  {
    name: 'fibonacci',
    file: '/fibonacci.uni',
    expected: [1, 2, 3, 89],
  },
];

beforeEach(() => {
  register(Injectable.FileMap, new FileMap());
});

for (const { name, file, expected } of examples) {
  it(name, async () => {
    const result = await evaluateEntryFile('./examples' + file);

    expect(result).toEqual(expected);
  });
}
