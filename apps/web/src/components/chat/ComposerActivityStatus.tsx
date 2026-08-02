import { memo } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { SubagentActivityIndicator } from "./SubagentActivityIndicator";

export const ComposerActivityStatus = memo(function ComposerActivityStatus(props: {
  readonly activity: {
    readonly title: string;
    readonly detail?: string;
  };
  readonly activeSubagentCount: number;
  readonly theme: "light" | "dark";
}) {
  const statusLabel = [
    props.activity.title,
    props.activity.detail,
    props.activeSubagentCount > 0
      ? `${props.activeSubagentCount} ${props.activeSubagentCount === 1 ? "sub-agent" : "sub-agents"} running`
      : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex justify-center px-4 pb-2 sm:px-5 sm:pb-2.5">
      <div
        aria-label={statusLabel}
        className="composer-activity-status grid w-full max-w-[38rem] min-w-0 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-full border px-2.5 py-1.5 text-[13px] sm:px-3"
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
        <span aria-hidden="true" className="composer-activity-copy min-w-0">
          <span className="composer-activity-copy-line block truncate" key={props.activity.title}>
            {props.activity.title}
          </span>
          {props.activity.detail ? (
            <span
              className="composer-activity-copy-detail block truncate text-[12px] text-muted-foreground"
              key={props.activity.detail}
            >
              {props.activity.detail}
            </span>
          ) : null}
        </span>
        <SubagentActivityIndicator count={props.activeSubagentCount} />
      </div>
    </div>
  );
});
