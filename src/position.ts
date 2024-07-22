import { assert, clamp } from './utils.js';

/**
 * Represents a position in a source string.
 * Includes the start item and excludes the end item.
 * So range like `{ start: 3, end: 5 }` will only include the 3rd and 4th characters.
 */
export type Position = { start: number; end: number };
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

export const tokenPosToSrcPos = (
  tokenPos: Position,
  tokens: Position[]
): Position => {
  assert(tokenPos.start >= 0, 'tokenPos.start must be greater than or equal 0');
  assert(
    tokenPos.start <= tokenPos.end,
    'tokenPos.start must be less than or equal to tokenPos.end'
  );
  assert(
    tokenPos.end <= tokens.length,
    'tokenPos.end must be less than or equal to tokens.length'
  );
  if (tokenPos.start === tokenPos.end)
    return indexPosition(tokens[tokenPos.start].start);

  if (tokenPos.start === tokens.length)
    return indexPosition(tokens[tokens.length - 1].end);

  const startToken = tokens[tokenPos.start];
  const endToken = tokens[clamp(tokenPos.end - 1, 0, tokens.length)];

  return position(startToken.start, endToken.end);
};
