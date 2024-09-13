import { beforeEach, expect, it } from 'vitest';
import { getModule } from '../src/files.ts';
import path from 'path';
import { assert, inspect, unreachable } from '../src/utils.ts';
import { inject, Injectable, register } from '../src/injector.ts';
import { FileMap } from 'codespan-napi';
import { newContext } from '../src/evaluate.ts';

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
  {
    name: 'basic hello world via script',
    file: '/hello_world.uni',
    expected: 'Hello, World!',
  },
  {
    name: 'basic hello world via module',
    file: '/hello_world_module.unim',
    expected: 113456,
  },
  {
    name: 'bubble sort',
    file: '/bubble_sort.uni',
    expected: [5, 4, 3, 2, 2, 1],
  },
  {
    name: 'quick sort',
    file: '/quick_sort.uni',
    expected: [5, 4, 3, 2, 2, 1],
  },
  {
    name: 'fibonacci',
    file: '/fibonacci.uni',
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

    if ('script' in module) {
      expect(module.script).toEqual(expected);
    } else if ('module' in module) {
      const main = module.default;
      inspect(module);
      assert(
        typeof main === 'function',
        'default export from runnable module must be a function'
      );
      const fileId = inject(Injectable.FileMap).getFileId(file);
      expect(
        await main([], [{ start: 0, end: 0 }, 0, newContext(fileId, file)])
      ).toEqual(expected);
    } else {
      unreachable('must be a script or a module');
    }
  });
}
