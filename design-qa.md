# Composer activity rail design QA

- Source visual truth: `C:/Users/LENOVO/AppData/Local/Temp/codex-clipboard-b3c1648d-f720-441f-be97-25b0744dddc0.png`
- Overlap feedback reference: `C:/Users/LENOVO/AppData/Local/Temp/codex-clipboard-a8f7dd04-3bb3-4c1e-8316-7cc253ae68da.png`
- Implementation screenshot: `C:/Users/LENOVO/.codex/visualizations/2026/08/02/019fc06a-1ac8-7220-ac62-1e6f62571f45/composer-activity-frosted-rounded.jpg`
- Combined focused comparison: `C:/Users/LENOVO/.codex/visualizations/2026/08/02/019fc06a-1ac8-7220-ac62-1e6f62571f45/composer-activity-reference-comparison.jpg`
- Viewport: Electron desktop, 1249 × 670 logical pixels, dark theme
- Source pixels: 1165 × 325
- Implementation pixels: 1249 × 670
- Density normalization: logical-pixel Electron capture; focused composer crop and source were proportionally resized to 1000 px wide for visual comparison only
- State: active turn with one live sub-agent

## Full-view comparison evidence

The activity state is anchored directly above the composer and no longer occupies a virtualized message row. The composer remains bottom-docked, while the timeline continues independently behind the overlay.

## Focused-region comparison evidence

The combined comparison confirms the same left-to-right hierarchy as the reference: animated thinking orb, Thinking label, divider, gradient sub-agent orb/count, and label. The final implementation intentionally adds the requested compact frosted capsule so response text cannot visually compete with the status.

## Required fidelity surfaces

- Fonts and typography: existing T3 UI typography, size, weight, and muted hierarchy are preserved.
- Spacing and layout rhythm: the rail aligns to composer input padding and maintains a small vertical gap above the composer.
- Colors and visual tokens: existing foreground/background/border tokens are used; the frosted surface remains subtle in dark mode.
- Image and asset fidelity: the existing ThinkingOrb canvas and sub-agent visuals are reused without replacement assets.
- Copy and content: Thinking, singular/plural sub-agent labels, and accessible running counts match the live state.

## Comparison history

1. Earlier implementation used a transparent rail. The overlap feedback showed response copy bleeding through the status and reducing legibility (P2).
2. Added a localized translucent background, subtle border, shadow, and backdrop blur.
3. Increased the container radius to a full capsule at the user's request.
4. Post-fix Electron capture shows the status remains legible over response content with no actionable P0/P1/P2 mismatch.

## Findings

No actionable P0, P1, or P2 findings remain. The frosted capsule is an intentional deviation from the original transparent reference based on the user's follow-up feedback.

## Verification

- Electron page identity and non-blank render: passed
- Accessible status: `Thinking, 1 sub-agent running`
- Focused component tests: 19 passed across the composer activity and timeline suites
- Web typecheck: passed
- Targeted lint: passed
- Relevant framework overlay or console error: none observed

final result: passed
