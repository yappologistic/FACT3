import { describe, expect, it } from "vite-plus/test";

import { hexToHsv, hexToRgb, hsvToHex, normalizeHexColor, rgbToHex } from "./color";

describe("color utilities", () => {
  it("normalizes valid six-digit hex colors", () => {
    expect(normalizeHexColor("  #CC7D5E ")).toBe("#cc7d5e");
    expect(normalizeHexColor("#fff")).toBeNull();
    expect(normalizeHexColor("not-a-color")).toBeNull();
  });

  it("converts between hex and RGB", () => {
    expect(hexToRgb("#cc7d5e")).toEqual({ red: 204, green: 125, blue: 94 });
    expect(rgbToHex({ red: 204, green: 125, blue: 94 })).toBe("#cc7d5e");
  });

  it("round-trips representative colors through HSV", () => {
    for (const color of ["#ff0000", "#16a34a", "#2563eb", "#cc7d5e", "#ffffff", "#000000"]) {
      const hsv = hexToHsv(color);
      expect(hsv).not.toBeNull();
      expect(hsvToHex(hsv!)).toBe(color);
    }
  });

  it("clamps out-of-range RGB channels", () => {
    expect(rgbToHex({ red: 999, green: -10, blue: 127.6 })).toBe("#ff0080");
  });
});
