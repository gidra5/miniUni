import { test } from '@fast-check/vitest';
import { editDistance } from '../../src/utils';
import { describe, expect } from 'vitest';
import { string, tuple } from 'fast-check';

describe('edit distance', () => {
  test.prop([tuple(string(), string()).filter(([a, b]) => a !== b)])(
    'd(a, b) > 0, a != b',
    ([str1, str2]) => {
      const result = editDistance(str1, str2);

      expect(result > 0).toBe(true);
    }
  );

  test.prop([string()])('d(a, a) = 0', (str) => {
    const result = editDistance(str, str);

    expect(result).toStrictEqual(0);
  });

  test.prop([string(), string()])('d(a, b) = d(b, a)', (str1, str2) => {
    const result1 = editDistance(str1, str2);
    const result2 = editDistance(str2, str1);

    expect(result1).toStrictEqual(result2);
  });

  test.prop([string(), string(), string()])(
    'd(a, b) + d(b, c) >= d(a, c)',
    (str1, str2) => {
      const result1 = editDistance(str1, str2);
      const result2 = editDistance(str2, str1);

      expect(result1).toStrictEqual(result2);
    }
  );

  test.prop([string()])('with empty 1', (str) => {
    const result = editDistance('', str);

    expect(result).toStrictEqual(str.length);
  });

  test('with with 1 insertion', () => {
    const result = editDistance('hello here', 'hello there');

    expect(result).toStrictEqual(1);
  });

  test('with with 1 swap', () => {
    const result = editDistance('hello htere', 'hello there');

    expect(result).toStrictEqual(1);
  });

  test('with with 1 substitute', () => {
    const result = editDistance('hello where', 'hello there');

    expect(result).toStrictEqual(1);
  });
});
