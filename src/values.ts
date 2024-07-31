import { assert } from './utils.js';

export type EvalFunction = (arg: EvalValue) => Promise<EvalValue>;
export type EvalValue =
  | number
  | string
  | boolean
  | null
  | EvalValue[]
  | EvalFunction
  | { record: Record<string, EvalValue> }
  | { channel: symbol };
type Channel = {
  queue: (EvalValue | Error)[];
  onReceive: Array<{
    resolve: (v: EvalValue) => void;
    reject: (e: unknown) => void;
  }>;
};

export const fn = (
  n: number,
  f: (...args: EvalValue[]) => EvalValue | Promise<EvalValue>
) => {
  return async (arg: EvalValue) => {
    if (n === 1) return await f(arg);
    return fn(n - 1, async (...args) => f(arg, ...args));
  };
};

export function isChannel(
  channelValue: EvalValue
): channelValue is { channel: symbol } {
  return (
    !!channelValue &&
    typeof channelValue === 'object' &&
    'channel' in channelValue
  );
}

export function isRecord(
  recordValue: EvalValue
): recordValue is { record: Record<string, EvalValue> } {
  return (
    !!recordValue && typeof recordValue === 'object' && 'record' in recordValue
  );
}

const channels: Record<symbol, Channel> = {};

export const createChannel = () => {
  const channel = Symbol();
  channels[channel] = {
    queue: [],
    onReceive: [],
  };
  return { channel };
};

export const getChannel = (c: EvalValue) => {
  assert(isChannel(c), 'not a channel');
  assert(c.channel in channels, 'channel not found');
  const channel = channels[c.channel];
  return channel;
};

export const send = (_channel: EvalValue, value: EvalValue | Error) => {
  const channel = getChannel(_channel);
  const promise = channel.onReceive.shift();
  if (promise) {
    const { resolve, reject } = promise;
    if (value instanceof Error) reject(value);
    else resolve(value);

    channel.onReceive = channel.onReceive.filter(
      (_promise) => _promise !== promise
    );
  } else channel.queue.push(value);
};

export const receive = (_channel: EvalValue) => {
  const channel = getChannel(_channel);

  if (channel.queue.length > 0) {
    const next = channel.queue.shift()!;
    if (next instanceof Error) throw next;
    return next;
  }

  return new Promise<EvalValue>((resolve, reject) => {
    const promise = {
      resolve: (v: EvalValue) => {
        resolve(v);
        channel.onReceive = channel.onReceive.filter(
          (_promise) => _promise !== promise
        );
      },

      reject: (e: unknown) => {
        reject(e);
        channel.onReceive = channel.onReceive.filter(
          (_promise) => _promise !== promise
        );
      },
    };

    channel.onReceive.push(promise);
  });
};
