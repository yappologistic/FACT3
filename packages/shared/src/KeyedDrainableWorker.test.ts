import { it } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

import { makeKeyedDrainableWorker } from "./KeyedDrainableWorker.ts";

describe("makeKeyedDrainableWorker", () => {
  it.live("keeps FIFO order for one key", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const processed: number[] = [];
        const worker = yield* makeKeyedDrainableWorker<string, number, never, never>((item) =>
          Effect.sync(() => processed.push(item)).pipe(Effect.asVoid),
        );

        yield* worker.enqueue("thread-1", 1);
        yield* worker.enqueue("thread-1", 2);
        yield* worker.enqueue("thread-1", 3);
        yield* worker.drain;

        expect(processed).toEqual([1, 2, 3]);
      }),
    ),
  );

  it.live("processes different keys concurrently", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>();
        const secondStarted = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const worker = yield* makeKeyedDrainableWorker<string, string, never, never>((item) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(
              item === "first" ? firstStarted : secondStarted,
              undefined,
            ).pipe(Effect.orDie);
            yield* Deferred.await(release);
          }),
        );

        yield* worker.enqueue("thread-1", "first");
        yield* worker.enqueue("thread-2", "second");
        yield* Deferred.await(firstStarted);
        yield* Deferred.await(secondStarted);
        yield* Deferred.succeed(release, undefined);
        yield* worker.drain;
      }),
    ),
  );

  it.live("drains work enqueued after a key becomes idle", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const processed: string[] = [];
        const worker = yield* makeKeyedDrainableWorker<string, string, never, never>((item) =>
          Effect.sync(() => processed.push(item)).pipe(Effect.asVoid),
        );

        yield* worker.enqueue("thread-1", "first");
        yield* worker.drain;
        yield* worker.enqueue("thread-1", "second");
        yield* worker.drain;

        expect(processed).toEqual(["first", "second"]);
      }),
    ),
  );
});
