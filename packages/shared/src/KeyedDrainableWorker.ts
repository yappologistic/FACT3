/**
 * KeyedDrainableWorker - FIFO processing per key with concurrency across keys.
 *
 * Items for the same key are processed in enqueue order. Different keys may be
 * processed concurrently. `drain` resolves only after every accepted item has
 * finished processing.
 *
 * @module KeyedDrainableWorker
 */
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as TxQueue from "effect/TxQueue";
import * as TxRef from "effect/TxRef";

export interface KeyedDrainableWorker<K, A> {
  readonly enqueue: (key: K, item: A) => Effect.Effect<void>;
  readonly drain: Effect.Effect<void>;
}

interface KeyedDrainableWorkerState<K, A> {
  readonly itemsByKey: Map<K, ReadonlyArray<A>>;
  readonly scheduledKeys: Set<K>;
  readonly activeKeys: Set<K>;
  readonly outstanding: number;
}

export const makeKeyedDrainableWorker = <K, A, E, R>(
  process: (item: A) => Effect.Effect<void, E, R>,
  options?: { readonly maxConcurrency?: number },
): Effect.Effect<KeyedDrainableWorker<K, A>, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const readyKeys = yield* Effect.acquireRelease(TxQueue.unbounded<K>(), TxQueue.shutdown);
    const stateRef = yield* TxRef.make<KeyedDrainableWorkerState<K, A>>({
      itemsByKey: new Map(),
      scheduledKeys: new Set(),
      activeKeys: new Set(),
      outstanding: 0,
    });
    const semaphore =
      options?.maxConcurrency === undefined
        ? undefined
        : yield* Semaphore.make(Math.max(1, Math.floor(options.maxConcurrency)));
    const processItem = (item: A) =>
      semaphore === undefined ? process(item) : semaphore.withPermits(1)(process(item));

    const processKey = (key: K): Effect.Effect<void, E, R> =>
      TxRef.modify(stateRef, (state) => {
        const items = state.itemsByKey.get(key) ?? [];
        if (items.length === 0) {
          const activeKeys = new Set(state.activeKeys);
          activeKeys.delete(key);
          return [Option.none<A>(), { ...state, activeKeys }] as const;
        }

        const itemsByKey = new Map(state.itemsByKey);
        if (items.length === 1) {
          itemsByKey.delete(key);
        } else {
          itemsByKey.set(key, items.slice(1));
        }
        return [Option.some(items[0] as A), { ...state, itemsByKey }] as const;
      }).pipe(
        Effect.tx,
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.void,
            onSome: (item) =>
              processItem(item).pipe(
                Effect.catchCause((cause) =>
                  Cause.hasInterruptsOnly(cause)
                    ? Effect.failCause(cause)
                    : Effect.logWarning("keyed drainable worker item failed", {
                        cause: Cause.pretty(cause),
                      }),
                ),
                Effect.ensuring(
                  TxRef.update(stateRef, (state) => ({
                    ...state,
                    outstanding: state.outstanding - 1,
                  })),
                ),
                Effect.flatMap(() => processKey(key)),
              ),
          }),
        ),
      );

    yield* TxQueue.take(readyKeys).pipe(
      Effect.flatMap((key) =>
        TxRef.update(stateRef, (state) => {
          const scheduledKeys = new Set(state.scheduledKeys);
          scheduledKeys.delete(key);
          const activeKeys = new Set(state.activeKeys);
          activeKeys.add(key);
          return { ...state, scheduledKeys, activeKeys };
        }).pipe(
          Effect.tx,
          Effect.flatMap(() => processKey(key)),
          Effect.forkScoped,
        ),
      ),
      Effect.forever,
      Effect.forkScoped,
    );

    const enqueue: KeyedDrainableWorker<K, A>["enqueue"] = (key, item) =>
      TxRef.modify(stateRef, (state) => {
        const itemsByKey = new Map(state.itemsByKey);
        itemsByKey.set(key, [...(itemsByKey.get(key) ?? []), item]);

        if (state.scheduledKeys.has(key) || state.activeKeys.has(key)) {
          return [false, { ...state, itemsByKey, outstanding: state.outstanding + 1 }] as const;
        }

        const scheduledKeys = new Set(state.scheduledKeys);
        scheduledKeys.add(key);
        return [
          true,
          { ...state, itemsByKey, scheduledKeys, outstanding: state.outstanding + 1 },
        ] as const;
      }).pipe(
        Effect.flatMap((shouldSchedule) =>
          shouldSchedule ? TxQueue.offer(readyKeys, key) : Effect.void,
        ),
        Effect.tx,
        Effect.asVoid,
      );

    const drain: KeyedDrainableWorker<K, A>["drain"] = TxRef.get(stateRef).pipe(
      Effect.tap((state) => (state.outstanding > 0 ? Effect.txRetry : Effect.void)),
      Effect.asVoid,
      Effect.tx,
    );

    return { enqueue, drain } satisfies KeyedDrainableWorker<K, A>;
  });
