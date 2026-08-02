import { describe, expect, it } from "vite-plus/test";

import {
  FLOATING_SQUIRCLE_CLIP_PATH_CLASS_NAME,
  FLOATING_SQUIRCLE_ITEM_CLASS_NAME,
  FLOATING_SQUIRCLE_SURFACE_CLASS_NAME,
} from "./floatingSquircle";

describe("floating squircle geometry", () => {
  it("keeps inset surfaces concentric with their popup shell", () => {
    expect(FLOATING_SQUIRCLE_SURFACE_CLASS_NAME).toBe("rounded-[20px]!");
    expect(FLOATING_SQUIRCLE_ITEM_CLASS_NAME).toBe("rounded-[16px]");
    expect(FLOATING_SQUIRCLE_CLIP_PATH_CLASS_NAME).toBe("[clip-path:inset(0_round_20px)]");
  });
});
