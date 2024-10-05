import type { EvalContext } from './evaluate/index.js';
import { Position } from './position.js';
import { assert, eventLoopYield, inspect } from './utils.js';
import { SystemError } from './error.js';
import { Environment } from './environment.js';

export type CallSite = [Position, EvalContext];
export type EvalFunction = (
  callSite: CallSite,
  arg: EvalValue
) => Promise<EvalValue>;
type EvalSymbol = symbol;

export type EvalRecord = Map<EvalValue, EvalValue>;

type EvalChannel = EvalSymbol;
type EvalEvent = EvalSymbol;
export type EvalEffect = {
  effect: EvalValue;
  value: EvalValue;
  env: Environment;
  continuations: EvalFunction[];
};
type EvalHandler = {
  handler: EvalFunction;
};

export type EvalValue =
  | number
  | string
  | boolean
  | null
  | EvalValue[]
  | EvalFunction
  | EvalSymbol
  | EvalRecord
  | EvalChannel
  | EvalEvent
  | EvalEffect
  | EvalHandler;

type ChannelReceiver = {
  resolve: (v: EvalValue | null) => void;
  reject: (e: unknown) => void;
};
type Channel = {
  closed?: boolean;
  queue: (EvalValue | Error)[];
  onReceive: Array<ChannelReceiver>;
};
export enum ChannelStatus {
  Empty = 'empty',
  Pending = 'pending',
  Queued = 'queued',
  Closed = 'closed',
}

export const fn = (
  n: number,
  f: (
    callSite: CallSite,
    ...args: EvalValue[]
  ) => EvalValue | Promise<EvalValue>
): EvalFunction => {
  return async (callSite, arg) => {
    if (n === 1) return await f(callSite, arg);
    return fn(n - 1, async (callSite, ...args) => f(callSite, arg, ...args));
  };
};

const atoms = new Map<string, symbol>();

export const symbol = (): EvalSymbol => Symbol();
export const atom = (name: string): EvalSymbol => {
  if (!atoms.has(name)) atoms.set(name, Symbol(name));
  return atoms.get(name)!;
};

export function isChannel(
  channelValue: EvalValue
): channelValue is EvalChannel {
  return (
    !!channelValue &&
    typeof channelValue === 'symbol' &&
    channelValue in channels
  );
}

export function isRecord(recordValue: unknown): recordValue is EvalRecord {
  return !!recordValue && recordValue instanceof Map;
}

export function isSymbol(symbolValue: EvalValue): symbolValue is EvalSymbol {
  return !!symbolValue && typeof symbolValue === 'symbol';
}

export function isEffect(value: EvalValue): value is EvalEffect {
  return !!value && typeof value === 'object' && 'effect' in value;
}

export function isHandler(value: EvalValue): value is EvalHandler {
  return !!value && typeof value === 'object' && 'handler' in value;
}

const channels: Record<symbol, Channel> = {};

const channelStatus = (c: symbol): ChannelStatus => {
  const channel = channels[c];
  if (!channel) return ChannelStatus.Closed;

  while (channel.onReceive.length > 0 && channel.queue.length > 0) {
    const receiver = channel.onReceive.shift()!;
    const value = channel.queue.shift()!;
    if (value instanceof Error) {
      receiver.reject(value);
    } else {
      receiver.resolve(value);
    }
  }

  if (channel.queue.length > 0) return ChannelStatus.Pending;
  if (channel.onReceive.length > 0) return ChannelStatus.Queued;
  if (channel.closed) return ChannelStatus.Closed;

  return ChannelStatus.Empty;
};

export const createChannel = (name = 'channel'): EvalChannel => {
  const channel = Symbol(name);
  channels[channel] = {
    closed: false,
    queue: [],
    onReceive: [],
  };
  return channel;
};

export const closeChannel = (c: symbol) => {
  const status = channelStatus(c);
  if (status === ChannelStatus.Closed) throw new Error('channel closed');
  channels[c].closed = true;
};

export const getChannel = (c: symbol) => {
  return channels[c];
};

export const send = (c: symbol, value: EvalValue | Error): ChannelStatus => {
  const status = channelStatus(c);

  if (status === ChannelStatus.Queued) {
    const receiver = channels[c].onReceive.shift()!;
    if (value instanceof Error) receiver.reject(value);
    else receiver.resolve(value);
  }

  if (status !== ChannelStatus.Closed) {
    channels[c].queue.push(value);
  } else {
    throw new Error('channel closed');
  }

  return status;
};

export const receive = async (c: symbol): Promise<EvalValue> => {
  const [value, status] = tryReceive(c);
  if (status === ChannelStatus.Pending) {
    if (value instanceof Error) throw value;
    return value;
  }
  if (status === ChannelStatus.Closed) throw new Error('channel closed');

  return new Promise((resolve, reject) => {
    channels[c].onReceive.push({ resolve, reject });
  });
};

export const tryReceive = (c: symbol): [EvalValue | Error, ChannelStatus] => {
  const status = channelStatus(c);

  if (status === ChannelStatus.Pending) {
    const value = channels[c].queue.shift()!;
    return [value, status];
  }

  return [null, status];
};

type _Event = {
  closed: boolean;
  emit: (cs: CallSite, value: EvalValue) => Promise<void>;
  subscribe: (listener: EvalFunction) => EvalFunction;
};
const events = new Map<symbol, _Event>();

export const createEvent = (name: string = 'event'): EvalEvent => {
  const listeners: Array<EvalFunction> = [];
  const event = Symbol(name);
  events.set(event, {
    closed: false,
    async emit(cs, v) {
      for (const listener of listeners) await listener(cs, v);
    },
    subscribe(listener) {
      assert(typeof listener === 'function', 'expected function');
      listeners.push(listener);
      return async () => {
        listeners.filter((x) => x !== listener);
        return null;
      };
    },
  });
  return event;
};

export const isEvent = (event: EvalValue): event is EvalEvent => {
  return !!event && typeof event === 'symbol' && events.has(event);
};

export const isEventClosed = (event: EvalValue): boolean => {
  if (!isEvent(event)) throw new Error('expected event');
  return events.get(event)!.closed;
};

export const closeEvent = (event: EvalValue) => {
  if (!isEvent(event)) throw new Error('expected event');
  if (events.get(event)!.closed) throw new Error('event closed');
  events.get(event)!.closed = true;
};

export const onceEvent = (event: EvalValue, f: EvalFunction) => {
  const unsubscribe = subscribeEvent(event, async (cs, v) => {
    await f(cs, v);
    await unsubscribe(cs, null);
    return null;
  });
  return unsubscribe;
};

export const emitEvent = async (
  cs: CallSite,
  event: EvalValue,
  value: EvalValue
) => {
  if (!isEvent(event)) throw new Error('expected event');
  if (events.get(event)!.closed) throw new Error('event closed');
  await events.get(event)!.emit(cs, value);
};

export const subscribeEvent = (event: EvalValue, listener: EvalFunction) => {
  if (!isEvent(event)) throw new Error('expected event');
  if (events.get(event)!.closed) throw new Error('event closed');
  return events.get(event)!.subscribe(listener);
};

export const nextEvent = (event: EvalValue) => {
  return new Promise<EvalValue>((resolve) =>
    onceEvent(event, async (ca, v) => {
      resolve(v);
      return null;
    })
  );
};

export type EvalTask = [taskAwait: EvalChannel, taskCancel: EvalEvent];

export const isTask = (task: EvalValue): task is EvalTask => {
  return (
    !!task &&
    Array.isArray(task) &&
    task.length === 2 &&
    isChannel(task[0]) &&
    isEvent(task[1])
  );
};

export const createTask = (
  cs: CallSite,
  f: () => Promise<EvalValue>
): EvalTask => {
  const awaitChannel = createChannel('task await');
  const cancelEvent = createEvent('task cancel');
  let status = 'pending';

  const unsub = onceEvent(cancelEvent, async (cs) => {
    if (status === 'resolved') return null;
    status = 'cancelled';
    send(awaitChannel, null);
    closeChannel(awaitChannel);
    closeEvent(cancelEvent);
    return null;
  });

  f().then(
    (value) => {
      if (status === 'cancelled') return;
      status = 'resolved';
      unsub(cs, null);
      send(awaitChannel, value);
      closeChannel(awaitChannel);
    },
    (e) => {
      if (status === 'cancelled') return;
      status = 'resolved';
      unsub(cs, null);
      send(awaitChannel, e);
      closeChannel(awaitChannel);
    }
  );

  return [awaitChannel, cancelEvent];
};

export const cancelTask = async (cs: CallSite, task: EvalTask) => {
  await emitEvent(cs, task[1], null);

  return null;
};

export const awaitTask = async (task: EvalTask): Promise<EvalValue> => {
  const taskAwait = task[0];
  return await receive(taskAwait);
};

export const fileHandle = (file: EvalRecord): EvalRecord => {
  return createRecord({
    write: async (cs, data) => {
      const [position, context] = cs;
      const fileId = context.fileId;
      const writeErrorFactory = SystemError.invalidArgumentType(
        'all',
        { args: [['data', 'string']], returns: 'void' },
        position
      );
      assert(typeof data === 'string', writeErrorFactory(0).withFileId(fileId));
      const write = recordGet(file, 'write');
      assert(typeof write === 'function', 'expected write to be a function');
      await write(cs, data);
      return null;
    },
  });
};

export const createSet = (values: EvalValue[]): EvalRecord => {
  const set = new Set(values);
  return createRecord({
    add: async (cs, value) => {
      const [position, context] = cs;
      const fileId = context.fileId;
      const addErrorFactory = SystemError.invalidArgumentType(
        'add',
        { args: [['value', 'a']], returns: 'void' },
        position
      );
      assert(typeof value === 'string', addErrorFactory(0).withFileId(fileId));
      set.add(value);
      return null;
    },
    values: async () => [...set.values()],
  });
};

export const createRecord = (
  values: Record<PropertyKey, EvalValue> | Array<[EvalValue, EvalValue]> = {}
): EvalRecord => {
  if (Array.isArray(values)) return new Map(values);
  const keys = [
    ...Object.getOwnPropertyNames(values),
    ...Object.getOwnPropertySymbols(values),
  ];
  const entries: [EvalValue, EvalValue][] = keys.map((k) => [k, values[k]]);
  return new Map(entries);
};

export const recordGet = (record: EvalRecord, key: EvalValue): EvalValue => {
  return record.get(key) ?? null;
};

export const recordSet = (
  record: EvalRecord,
  key: EvalValue,
  value: EvalValue
) => {
  record.set(key, value);
};

export const recordDelete = (record: EvalRecord, key: EvalValue) => {
  record.delete(key);
};

export const recordMerge = (
  record: EvalRecord,
  other: EvalRecord
): EvalRecord => {
  return new Map([...record, ...other]);
};

export const recordOmit = (
  record: EvalRecord,
  keys: EvalValue[]
): EvalRecord => {
  return new Map([...record.entries()].filter(([key]) => !keys.includes(key)));
};

export const recordHas = (record: EvalRecord, key: EvalValue): boolean => {
  return record.has(key);
};

export const createEffect = (
  effect: EvalValue,
  value: EvalValue,
  env: Environment,
  continuations: EvalFunction[] = [
    // async (cs, v) => {
    //   showPos(cs[0], cs[1], `effect ${String(effect)} ${String(value)}`);
    //   return v;
    // },
  ]
): EvalEffect => ({ effect, value, env, continuations });

export const createHandler = (handler: EvalFunction): EvalHandler => ({
  handler,
});
