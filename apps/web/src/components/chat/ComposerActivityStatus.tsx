import { memo } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { SubagentActivityIndicator } from "./SubagentActivityIndicator";

export const ComposerActivityStatus = memo(function ComposerActivityStatus(props: {
  readonly activeSubagentCount: number;
  readonly theme: "light" | "dark";
}) {
  const statusLabel =
    props.activeSubagentCount > 0
      ? `Thinking, ${props.activeSubagentCount} ${props.activeSubagentCount === 1 ? "sub-agent" : "sub-agents"} running`
      : "Thinking";

  return (
    <div className="px-4 pb-2 sm:px-5 sm:pb-2.5">
      <div
        aria-label={statusLabel}
        className="composer-activity-status flex w-fit max-w-full min-w-0 items-center gap-2 rounded-full border px-2.5 py-1 text-[13px] sm:px-3"
        data-chat-composer-activity="true"
        role="status"
      >
        <ThinkingOrb
          aria-hidden="true"
          className="thinking-orb-motion"
          size={64}
          state="composing"
          style={{ width: 32, height: 32, flex: "none" }}
          theme={props.theme}
        />
        <span aria-hidden="true" className="thinking-orb-shimmer" data-text="Thinking…">
          Thinking…
        </span>
        <SubagentActivityIndicator count={props.activeSubagentCount} />
      </div>
    </div>
  );
});
