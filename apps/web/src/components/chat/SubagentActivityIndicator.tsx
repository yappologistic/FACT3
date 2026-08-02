import { memo } from "react";

const MAX_VISIBLE_ORBS = 3;

export const SubagentActivityIndicator = memo(function SubagentActivityIndicator(props: {
  readonly count: number;
}) {
  if (props.count <= 0) {
    return null;
  }
  const visibleOrbCount = Math.min(props.count, MAX_VISIBLE_ORBS);

  return (
    <span
      aria-hidden="true"
      className="subagent-activity-indicator inline-flex shrink-0 items-center gap-2 border-l border-border/60 pl-3 text-xs text-muted-foreground"
      data-subagent-count={props.count}
    >
      <span className="flex items-center pl-1">
        {Array.from({ length: visibleOrbCount }, (_, index) => (
          <span
            className="subagent-activity-orb"
            data-orb-index={index}
            key={index}
            style={{ zIndex: visibleOrbCount - index }}
          />
        ))}
        <span className="subagent-activity-count" key={props.count}>
          {props.count}
        </span>
      </span>
      <span className="whitespace-nowrap">{props.count === 1 ? "sub-agent" : "sub-agents"}</span>
    </span>
  );
});
