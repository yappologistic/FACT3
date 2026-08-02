"use client";

import { XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ColorSelector } from "../color-selector";
import { Button } from "../ui/button";
import { ColorPicker } from "../ui/color-picker";
import { normalizeProviderAccentColor } from "../../providerInstances";
import { cn } from "../../lib/utils";

const PROVIDER_ACCENT_SWATCHES = [
  "#2563eb",
  "#16a34a",
  "#ea580c",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
] as const;

const FALLBACK_ACCENT_COLOR = PROVIDER_ACCENT_SWATCHES[0];

export function ProviderAccentColorPicker(props: {
  readonly displayName: string;
  readonly value: string | undefined;
  readonly onCommit: (value: string) => void;
  readonly description?: string;
  readonly commitDelayMs?: number;
}) {
  const { commitDelayMs = 0, description, displayName, onCommit, value } = props;
  const [optimisticValue, setOptimisticValue] = useState(() => value ?? "");
  const commitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommitRef = useRef<string | null>(null);
  const onCommitRef = useRef(onCommit);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    if (pendingCommitRef.current !== null) return;
    setOptimisticValue(value ?? "");
  }, [value]);

  useEffect(() => {
    return () => {
      if (commitTimeoutRef.current !== null) {
        clearTimeout(commitTimeoutRef.current);
      }
      const pendingCommit = pendingCommitRef.current;
      if (pendingCommit !== null) {
        onCommitRef.current(pendingCommit);
      }
    };
  }, []);

  const commitAccentColor = useCallback(
    (value: string) => {
      const normalizedValue = normalizeProviderAccentColor(value) ?? "";
      setOptimisticValue(normalizedValue);

      if (commitDelayMs <= 0) {
        pendingCommitRef.current = null;
        if (commitTimeoutRef.current !== null) {
          clearTimeout(commitTimeoutRef.current);
          commitTimeoutRef.current = null;
        }
        onCommit(normalizedValue);
        return;
      }

      pendingCommitRef.current = normalizedValue;
      if (commitTimeoutRef.current !== null) {
        clearTimeout(commitTimeoutRef.current);
      }
      commitTimeoutRef.current = setTimeout(() => {
        commitTimeoutRef.current = null;
        const pendingCommit = pendingCommitRef.current;
        pendingCommitRef.current = null;
        if (pendingCommit !== null) {
          onCommitRef.current(pendingCommit);
        }
      }, commitDelayMs);
    },
    [commitDelayMs, onCommit],
  );

  const normalized = normalizeProviderAccentColor(optimisticValue);
  const selectedValue =
    normalized &&
    PROVIDER_ACCENT_SWATCHES.includes(normalized as (typeof PROVIDER_ACCENT_SWATCHES)[number])
      ? normalized
      : "";
  const customSelected = Boolean(normalized && selectedValue === "");

  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium text-foreground">Accent color</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <ColorPicker
          align="start"
          className={cn(customSelected && "border-ring ring-2 ring-ring/24")}
          label={`${displayName} accent color`}
          value={normalized ?? FALLBACK_ACCENT_COLOR}
          onValueChange={commitAccentColor}
        />
        <ColorSelector
          key={selectedValue}
          colors={[...PROVIDER_ACCENT_SWATCHES]}
          defaultValue={selectedValue}
          size="lg"
          onColorSelect={commitAccentColor}
          className="flex-wrap gap-1.5"
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={cn(
            "size-7 shrink-0 text-muted-foreground transition-opacity",
            normalized ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={() => commitAccentColor("")}
          aria-label={`Clear accent color for ${displayName}`}
          aria-hidden={!normalized}
          tabIndex={normalized ? 0 : -1}
        >
          <XIcon className="size-3.5" aria-hidden />
        </Button>
      </div>
      {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
    </div>
  );
}
