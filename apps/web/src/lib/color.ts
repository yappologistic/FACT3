export interface RgbColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface HsvColor {
  readonly hue: number;
  readonly saturation: number;
  readonly value: number;
}

const HEX_COLOR_PATTERN = /^#[\da-f]{6}$/iu;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeHexColor(value: string): string | null {
  const normalized = value.trim();
  return HEX_COLOR_PATTERN.test(normalized) ? normalized.toLowerCase() : null;
}

export function hexToRgb(value: string): RgbColor | null {
  const normalized = normalizeHexColor(value);
  if (!normalized) return null;

  const numeric = Number.parseInt(normalized.slice(1), 16);
  return {
    red: (numeric >> 16) & 255,
    green: (numeric >> 8) & 255,
    blue: numeric & 255,
  };
}

export function rgbToHex(color: RgbColor): string {
  return `#${[color.red, color.green, color.blue]
    .map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function rgbToHsv(color: RgbColor): HsvColor {
  const red = clamp(color.red, 0, 255) / 255;
  const green = clamp(color.green, 0, 255) / 255;
  const blue = clamp(color.blue, 0, 255) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;

  let hue = 0;
  if (delta !== 0) {
    if (maximum === red) {
      hue = ((green - blue) / delta) % 6;
    } else if (maximum === green) {
      hue = (blue - red) / delta + 2;
    } else {
      hue = (red - green) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  return {
    hue,
    saturation: maximum === 0 ? 0 : delta / maximum,
    value: maximum,
  };
}

export function hexToHsv(value: string): HsvColor | null {
  const rgb = hexToRgb(value);
  return rgb ? rgbToHsv(rgb) : null;
}

export function hsvToHex(color: HsvColor): string {
  const hue = ((color.hue % 360) + 360) % 360;
  const saturation = clamp(color.saturation, 0, 1);
  const value = clamp(color.value, 0, 1);
  const chroma = value * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = value - chroma;
  const [red, green, blue] =
    hue < 60
      ? [chroma, secondary, 0]
      : hue < 120
        ? [secondary, chroma, 0]
        : hue < 180
          ? [0, chroma, secondary]
          : hue < 240
            ? [0, secondary, chroma]
            : hue < 300
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];

  return rgbToHex({
    red: (red + match) * 255,
    green: (green + match) * 255,
    blue: (blue + match) * 255,
  });
}
