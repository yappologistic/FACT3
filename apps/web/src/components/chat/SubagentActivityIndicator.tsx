import { memo } from "react";

const MAX_VISIBLE_ORBS = 3;

export const SubagentActivityIndicator = memo(function SubagentActivityIndicator(props: {
  readonly count: number;
  readonly active?: boolean;
}) {
  if (props.count <= 0) {
    return null;
  }
  const visibleOrbCount = Math.min(props.count, MAX_VISIBLE_ORBS);

  return (
    <span
      aria-hidden="true"
      className="subagent-activity-indicator grid shrink-0 justify-items-center border-l border-border/60 pl-3 text-muted-foreground"
      data-subagent-count={props.count}
    >
      <span className="subagent-activity-stack flex items-center">
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
      <span className="whitespace-nowrap text-[11px] leading-none">
        {props.count === 1 ? "sub-agent" : "sub-agents"}
        {props.active ? <span className="sr-only"> running</span> : null}
      </span>
    </span>
  );
});
