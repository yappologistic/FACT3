import type { ModelSelection, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { useId, useMemo } from "react";

import { getComposerProviderState } from "~/components/chat/composerProviderState";
import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { TraitsPicker } from "~/components/chat/TraitsPicker";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionForInstance,
} from "~/modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
  sortProviderInstanceEntries,
} from "~/providerInstances";

export function resolveKanbanModelSelection(
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection | null,
): ModelSelection | null {
  return resolveDefaultProviderModelSelection(providers, selection);
}

export function KanbanModelSelectionControls(props: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly settings: UnifiedSettings;
  readonly value: ModelSelection | null;
  readonly onChange: (selection: ModelSelection | null) => void;
  readonly label?: string;
  readonly helpText?: string;
  readonly triggerAriaLabel?: string;
}) {
  const labelId = useId();
  const entries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(
          deriveProviderInstanceEntries(props.providers),
          props.settings,
        ),
      ),
    [props.providers, props.settings],
  );
  const modelOptionsByInstance = useMemo(
    () => getCustomModelOptionsByInstance(props.settings, props.providers),
    [props.providers, props.settings],
  );
  const value = resolveKanbanModelSelection(props.providers, props.value);
  const activeEntry = value
    ? (entries.find((entry) => entry.instanceId === value.instanceId) ?? null)
    : null;

  if (!value || !activeEntry) {
    return (
      <div className="rounded-[14px] border border-destructive/15 bg-destructive/[0.035] px-3.5 py-3 text-[12px] leading-4 text-destructive-foreground/82">
        No enabled provider is available. Enable a provider in Settings before creating this task.
      </div>
    );
  }

  const selectModel = (instanceId: ProviderInstanceId, model: string) => {
    const entry = entries.find((candidate) => candidate.instanceId === instanceId);
    const resolvedModel = resolveAppModelSelectionForInstance(
      instanceId,
      props.settings,
      props.providers,
      model,
    );
    if (!entry || !resolvedModel) return;
    const { modelOptionsForDispatch } = getComposerProviderState({
      provider: entry.driverKind,
      model: resolvedModel,
      models: entry.models,
      modelOptions: undefined,
    });
    props.onChange({
      instanceId,
      model: resolvedModel,
      ...(modelOptionsForDispatch ? { options: modelOptionsForDispatch } : {}),
    });
  };

  return (
    <div role="group" aria-labelledby={labelId}>
      <p id={labelId} className="mb-1.5 text-[12px] font-medium leading-4 text-foreground/78">
        {props.label ?? "Agent runtime"}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-[14px] border border-foreground/[0.07] bg-foreground/[0.018] p-1.5">
        <ProviderModelPicker
          activeInstanceId={value.instanceId}
          model={value.model}
          lockedProvider={null}
          instanceEntries={entries}
          modelOptionsByInstance={modelOptionsByInstance}
          triggerVariant="outline"
          triggerAriaLabel={props.triggerAriaLabel ?? "Choose provider and model"}
          triggerClassName="h-8 max-w-[18rem] flex-1 justify-between px-2.5 text-[12px] sm:max-w-[22rem]"
          onInstanceModelChange={selectModel}
        />
        <TraitsPicker
          provider={activeEntry.driverKind}
          instanceId={activeEntry.instanceId}
          models={activeEntry.models}
          model={value.model}
          prompt=""
          onPromptChange={() => {}}
          modelOptions={value.options}
          allowPromptInjectedEffort={false}
          triggerVariant="outline"
          triggerClassName="h-8 max-w-[16rem] px-2.5 text-[12px]"
          onModelOptionsChange={(options) =>
            props.onChange({
              instanceId: value.instanceId,
              model: value.model,
              ...(options ? { options } : {}),
            })
          }
        />
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground/60">
        {props.helpText ??
          "The selected provider, model, reasoning level, and speed settings apply to this task only."}
      </p>
    </div>
  );
}
