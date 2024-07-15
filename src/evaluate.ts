import { parseScript } from './parser';
import { parseTokens } from './tokens';

export const evaluateScriptString = async (
  input: string,
  context: unknown = {}
) => {
  const tokens = parseTokens(input);
  const ast = parseScript(tokens);

  // return 0;
  throw new Error('Not implemented');
};
