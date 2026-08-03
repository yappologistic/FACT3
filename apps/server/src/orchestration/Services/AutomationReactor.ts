import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface AutomationReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class AutomationReactor extends Context.Service<AutomationReactor, AutomationReactorShape>()(
  "t3/orchestration/Services/AutomationReactor",
) {}
