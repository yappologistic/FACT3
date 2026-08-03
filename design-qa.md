# Kanban design QA

final result: passed

## Product intent

The board is a project-level control surface for parallel coding worktrees. It answers three
questions without duplicating Chat: what is running, what needs review, and what the user has
accepted as complete.

## Reference comparison

- Reference direction: the selected three-lane FACT3 board with a right-side task inspector.
- Verified build: the Electron board driven by real isolated worktrees and thread lifecycle state.
- The implemented board keeps the reference's centered Board/Chat switch, top-right worktree and
  history actions, clear lanes, compact worktree cards, and optional task inspector.
- A separate Planned lane was intentionally omitted because FACT3 has no durable pre-run task
  entity. Showing draft-looking cards from inferred data would make the board lie.
- Drag and drop was intentionally omitted because lane membership is derived from agent, review,
  settlement, and archive state. A visual move must not contradict the underlying lifecycle.

## Blocker gate

- **Purpose:** Every visible action maps to an existing workflow: create a worktree, switch views,
  inspect a task, open its chat or diff, use source control, complete or reopen work, and inspect or
  restore history.
- **Layout:** Three equal lanes remain readable at desktop widths. The inspector is inline when the
  viewport can support it and becomes a dismissible overlay on narrower windows.
- **Visual hierarchy:** Lane boundaries are subtle; cards carry the primary information; details
  remain hidden until selection. No decorative progress bars, filters, metrics, or status pills were
  added without a live data source.
- **Typography and spacing:** Uses the product's existing font, token, radius, button, card, and
  muted-text system. Long titles and branches truncate without causing horizontal page overflow.
- **Themes:** Verified in the app's dark and light modes, including the selected, hover-capable,
  empty, review, complete, and inspector surfaces.
- **Motion:** Running cards use OpenTUI-compatible spinner frames from one shared low-frequency
  scheduler. It stops when no spinner is mounted, pauses in hidden windows, and becomes static for
  reduced motion.
- **Accessibility:** Cards are buttons with pressed state, icon-only controls retain labels, focus
  rings use the existing design system, and animated glyph changes are hidden from assistive
  technology to avoid repeated announcements.
- **Responsive behavior:** Verified without document overflow at a compact desktop viewport; header
  actions collapse to labeled icon controls and the board stays horizontally navigable when needed.
- **Lifecycle truthfulness:** Running, Review, Complete, History, Reopen, and Restore were exercised
  against real Electron thread state. No second Kanban database or mock task state was introduced.
- **Source control:** A real worktree commit was created from the board, the board's Push action was
  verified against an isolated bare remote, a private test-repository pull request was detected by
  the app, and working-tree diff navigation was verified.

## Evidence

Screenshots are stored only in the ignored isolated test-artifacts directory under `.t3/kanban-e2e`.
They are deliberately excluded from version control.
