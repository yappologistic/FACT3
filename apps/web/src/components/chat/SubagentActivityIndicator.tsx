import { memo } from "react";

const MAX_VISIBLE_ORBS = 3;
const SUBAGENT_AVATAR_SOURCES = [
  "/subagent-avatars/plume.webp",
  "/subagent-avatars/islands.webp",
  "/subagent-avatars/ribbon.webp",
  "/subagent-avatars/vortex.webp",
  "/subagent-avatars/cells.webp",
  "/subagent-avatars/fan.webp",
  "/subagent-avatars/contours.webp",
  "/subagent-avatars/eclipse.webp",
  "/subagent-avatars/petals.webp",
  "/subagent-avatars/prism.webp",
] as const;
const SUBAGENT_AVATAR_CROPS = [
  "50% 66%",
  "34% 28%",
  "68% 56%",
  "46% 44%",
  "76% 30%",
  "28% 72%",
  "58% 78%",
  "38% 54%",
  "50% 50%",
  "52% 52%",
] as const;

export const SubagentAvatar = memo(function SubagentAvatar(props: {
  readonly animated?: boolean;
  readonly index: number;
  readonly zIndex?: number;
}) {
  const textureIndex = props.index % SUBAGENT_AVATAR_SOURCES.length;
  const cropIndex = props.index % SUBAGENT_AVATAR_CROPS.length;

  return (
    <span
      aria-hidden="true"
      className="subagent-activity-orb"
      data-animated={props.animated === false ? "false" : "true"}
      data-orb-index={textureIndex}
      style={props.zIndex === undefined ? undefined : { zIndex: props.zIndex }}
    >
      <img
        alt=""
        className="subagent-activity-orb-image"
        draggable={false}
        src={SUBAGENT_AVATAR_SOURCES[textureIndex]}
        style={{ objectPosition: SUBAGENT_AVATAR_CROPS[cropIndex] }}
      />
    </span>
  );
});

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
      className="subagent-activity-indicator flex min-w-20 shrink-0 items-center justify-center border-l border-border/60 px-3"
      data-subagent-count={props.count}
    >
      <span className="subagent-activity-stack flex items-center">
        {Array.from({ length: visibleOrbCount }, (_, index) => (
          <SubagentAvatar index={index} key={index} zIndex={visibleOrbCount - index} />
        ))}
        <span className="subagent-activity-count" key={props.count}>
          {props.count}
        </span>
      </span>
    </span>
  );
});
