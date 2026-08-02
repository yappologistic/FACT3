"use client";

import { PipetteIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { hexToHsv, hsvToHex, normalizeHexColor, type HsvColor } from "../../lib/color";
import { cn } from "../../lib/utils";
import { Input } from "./input";
import { Popover, PopoverPopup, PopoverTrigger } from "./popover";

const DEFAULT_COLOR = "#2563eb";

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function getSafeHsv(value: string) {
  return hexToHsv(value) ?? hexToHsv(DEFAULT_COLOR)!;
}

function ColorArea(props: {
  readonly color: HsvColor;
  readonly label: string;
  readonly onChange: (color: HsvColor) => void;
}) {
  const updateFromPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      props.onChange({
        ...props.color,
        saturation: clamp((event.clientX - bounds.left) / bounds.width),
        value: 1 - clamp((event.clientY - bounds.top) / bounds.height),
      });
    },
    [props],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    let nextColor: HsvColor | null = null;

    switch (event.key) {
      case "ArrowLeft":
        nextColor = { ...props.color, saturation: clamp(props.color.saturation - step) };
        break;
      case "ArrowRight":
        nextColor = { ...props.color, saturation: clamp(props.color.saturation + step) };
        break;
      case "ArrowUp":
        nextColor = { ...props.color, value: clamp(props.color.value + step) };
        break;
      case "ArrowDown":
        nextColor = { ...props.color, value: clamp(props.color.value - step) };
        break;
    }

    if (!nextColor) return;
    event.preventDefault();
    props.onChange(nextColor);
  };

  return (
    <div
      aria-label={`${props.label} saturation and brightness`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(props.color.saturation * 100)}
      aria-valuetext={`${Math.round(props.color.saturation * 100)}% saturation, ${Math.round(props.color.value * 100)}% brightness`}
      className="relative h-40 cursor-crosshair touch-none overflow-hidden rounded-[15px] outline-none ring-ring/35 transition-shadow focus-visible:ring-[3px]"
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event);
      }}
      role="slider"
      style={{
        backgroundColor: `hsl(${props.color.hue} 100% 50%)`,
        backgroundImage:
          "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
      }}
      tabIndex={0}
    >
      <span
        className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_1px_4px_rgb(0_0_0/0.55),0_0_0_1px_rgb(0_0_0/0.3)]"
        style={{
          left: `${props.color.saturation * 100}%`,
          top: `${(1 - props.color.value) * 100}%`,
        }}
      />
    </div>
  );
}

export interface ColorPickerProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly label: string;
  readonly className?: string;
  readonly align?: "start" | "center" | "end";
}

export function ColorPicker({
  align = "end",
  className,
  label,
  onValueChange,
  value,
}: ColorPickerProps) {
  const normalizedValue = normalizeHexColor(value) ?? DEFAULT_COLOR;
  const [color, setColor] = useState(() => getSafeHsv(normalizedValue));
  const [hexDraft, setHexDraft] = useState(normalizedValue.toUpperCase());
  const renderedColor = useMemo(() => hsvToHex(color), [color]);

  useEffect(() => {
    setColor(getSafeHsv(normalizedValue));
    setHexDraft(normalizedValue.toUpperCase());
  }, [normalizedValue]);

  const commitColor = useCallback(
    (nextColor: HsvColor) => {
      const nextValue = hsvToHex(nextColor);
      setColor(nextColor);
      setHexDraft(nextValue.toUpperCase());
      onValueChange(nextValue);
    },
    [onValueChange],
  );

  const commitHexDraft = () => {
    const nextValue = normalizeHexColor(hexDraft);
    if (!nextValue) {
      setHexDraft(renderedColor.toUpperCase());
      return;
    }
    setColor(getSafeHsv(nextValue));
    setHexDraft(nextValue.toUpperCase());
    onValueChange(nextValue);
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            aria-label={`Choose ${label}`}
            className={cn(
              "group flex h-8 min-w-32 cursor-pointer items-center gap-2 rounded-xl border border-input bg-card px-2 text-xs text-foreground shadow-xs/5 outline-none transition-[border-color,background-color,box-shadow] hover:border-foreground/20 hover:bg-accent/45 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24",
              className,
            )}
            type="button"
          >
            <span
              aria-hidden
              className="size-4 shrink-0 rounded-full ring-1 ring-black/12 shadow-[inset_0_1px_0_rgb(255_255_255/0.28)] dark:ring-white/16"
              style={{ backgroundColor: normalizedValue }}
            />
            <span className="font-mono uppercase tabular-nums text-foreground/90">
              {normalizedValue}
            </span>
          </button>
        }
      />
      <PopoverPopup
        align={align}
        side="bottom"
        sideOffset={7}
        className="w-64 overflow-hidden rounded-[20px] p-0 before:rounded-[19px] [--viewport-inline-padding:0px] [&_[data-slot=popover-viewport]]:p-0"
      >
        <div className="grid gap-3 p-3">
          <div className="flex items-center gap-2 px-0.5">
            <span
              aria-hidden
              className="size-5 rounded-full ring-1 ring-black/12 shadow-[inset_0_1px_0_rgb(255_255_255/0.3)] dark:ring-white/16"
              style={{ backgroundColor: renderedColor }}
            />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
              {label}
            </span>
            <span className="font-mono text-[11px] uppercase tabular-nums text-muted-foreground">
              {renderedColor}
            </span>
          </div>

          <ColorArea color={color} label={label} onChange={commitColor} />

          <div className="flex items-center gap-2 px-0.5">
            <PipetteIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              aria-label={`${label} hue`}
              className="h-3 min-w-0 flex-1 cursor-pointer appearance-none rounded-full outline-none ring-ring/35 focus-visible:ring-[3px] [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-transparent [&::-moz-range-thumb]:shadow-[0_1px_4px_rgb(0_0_0/0.45)] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgb(0_0_0/0.45)]"
              max={360}
              min={0}
              onChange={(event) =>
                commitColor({ ...color, hue: Number(event.currentTarget.value) })
              }
              style={{
                background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
              }}
              type="range"
              value={Math.round(color.hue)}
            />
          </div>

          <label className="grid gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Hex</span>
            <Input
              aria-label={`${label} hex value`}
              className="rounded-xl"
              nativeInput
              onBlur={commitHexDraft}
              onChange={(event) => setHexDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setHexDraft(renderedColor.toUpperCase());
                  event.currentTarget.blur();
                }
              }}
              spellCheck={false}
              value={hexDraft}
            />
          </label>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
