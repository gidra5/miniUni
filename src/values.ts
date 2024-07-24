export type EvalFunction = (arg: EvalValue) => Promise<EvalValue>;
export type EvalValue =
  | number
  | string
  | boolean
  | null
  | EvalValue[]
  | EvalFunction
  | { channel: symbol };

export const fn = (
  n: number,
  f: (...args: EvalValue[]) => EvalValue | Promise<EvalValue>
) => {
  return async (arg: EvalValue) => {
    if (n === 1) return await f(arg);
    return fn(n - 1, async (...args) => f(arg, ...args));
  };
};
