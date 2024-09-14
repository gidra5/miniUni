import { assert, clamp } from './utils.js';

/**
 * Represents a position in a source string.
 * Includes the start item and excludes the end item.
 * So range like `{ start: 3, end: 5 }` will only include the 3rd and 4th characters.
 */
export type Position = { start: number; end: number };

export function isPosition(value: any): value is Position {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.start === 'number' &&
    typeof value.end === 'number'
  );
}

export function position(start: number, end: number): Position {
  assert(start >= 0, 'start must be greater than or equal 0');
  assert(start <= end, 'start must be less than or equal to end');
  return { start, end };
}

export function intervalPosition(start: number, length: number): Position {
  return position(start, start + length);
}

export function indexPosition(pos: number): Position {
  return position(pos, pos);
}

export function mergePositions(...positions: Position[]): Position {
  assert(positions.length > 0, 'positions must not be empty');
  return positions.reduce((acc, pos) =>
    position(Math.min(acc.start, pos.start), Math.max(acc.end, pos.end))
  );
}

export const mapListPosToPos = (pos: Position, list: Position[]): Position => {
  assert(pos.start >= 0, 'pos.start must be greater than or equal 0');
  assert(
    pos.start <= pos.end,
    'pos.start must be less than or equal to pos.end'
  );
  assert(
    pos.end <= list.length,
    'pos.end must be less than or equal to list.length'
  );
  if (list.length === 0) return indexPosition(0);
  if (pos.start === pos.end) {
    const start = list[Math.max(pos.start - 1, 0)].end;
    if (pos.start === list.length) return indexPosition(start);
    if (pos.start === 0) return indexPosition(0);
    return position(start, list[pos.end].start);
  }

  if (pos.start === list.length)
    return indexPosition(list[list.length - 1].end);

  const startToken = list[pos.start];
  const endToken = list[clamp(pos.end - 1, 0, list.length)];

  return position(startToken.start, endToken.end);
};

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  const list = [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
    { start: 4, end: 5 },
  ];

  it('position list 1', () => {
    expect(mapListPosToPos({ start: 0, end: 1 }, list)).toEqual({
      start: 0,
      end: 1,
    });
  });

  it('position list 2', () => {
    expect(mapListPosToPos({ start: 0, end: 2 }, list)).toEqual({
      start: 0,
      end: 3,
    });
  });

  it('position list 3', () => {
    expect(mapListPosToPos({ start: 1, end: 1 }, list)).toEqual({
      start: 1,
      end: 2,
    });
  });

  it('position list 4', () => {
    expect(mapListPosToPos({ start: 1, end: 2 }, list)).toEqual({
      start: 2,
      end: 3,
    });
  });

  it('position list 5', () => {
    expect(mapListPosToPos({ start: 1, end: 3 }, list)).toEqual({
      start: 2,
      end: 5,
    });
  });

  it('position list 6', () => {
    expect(mapListPosToPos({ start: 3, end: 3 }, list)).toEqual({
      start: 5,
      end: 5,
    });
  });
}
