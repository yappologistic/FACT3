/**
 * Markdown-safe streaming adapter for Interior's Text Reveal. It keeps the
 * upstream word motion while leaving existing inline markup and clipboard
 * semantics intact.
 */

import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  useLayoutEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { motion } from "motion/react";

import { useTextReveal } from "./text-reveal";

const EASE = [0.23, 1, 0.32, 1] as const;
const DURATION = 0.6;
const STAGGER = 0.055;
const MAX_DURATION = 1.6;
const HIDDEN = { opacity: 0, y: 10, filter: "blur(8px)" } as const;
const SHOWN = { opacity: 1, y: 0, filter: "blur(0px)" } as const;

const NON_REVEALABLE_ELEMENTS = new Set(["button", "code", "pre", "script", "style", "svg"]);

export function InlineStreamingTextReveal({ text }: { text: string }) {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const leading = match?.[1] ?? "";
  const core = match?.[2] ?? "";
  const trailing = match?.[3] ?? "";
  const previousCountRef = useRef(0);
  const { ref, groups, count, started, reduced } = useTextReveal<HTMLSpanElement>({
    text: core,
    startOnView: false,
    stagger: STAGGER,
    maxDuration: MAX_DURATION,
  });
  const previousCount = Math.min(previousCountRef.current, count);
  const addedCount = Math.max(0, count - previousCount);
  const availableStaggerSpan = Math.max(0, MAX_DURATION - DURATION);
  const step = addedCount > 1 ? Math.min(STAGGER, availableStaggerSpan / (addedCount - 1)) : 0;

  useLayoutEffect(() => {
    previousCountRef.current = count;
  }, [count]);

  if (!core) return text;

  return (
    <>
      {leading}
      <span ref={ref} data-interior-text-reveal="streaming">
        {groups.map((group, groupIndex) => (
          <Fragment key={group.key}>
            {groupIndex > 0 ? " " : null}
            <span className="inline-block whitespace-nowrap align-baseline">
              {group.units.map((unit) => {
                const isNewUnit = unit.index >= previousCount;
                return (
                  <motion.span
                    key={unit.key}
                    className="inline-block align-baseline"
                    initial={reduced ? false : HIDDEN}
                    animate={started ? SHOWN : HIDDEN}
                    transition={
                      reduced
                        ? { duration: 0 }
                        : {
                            duration: DURATION,
                            ease: EASE,
                            delay: started && isNewUnit ? (unit.index - previousCount) * step : 0,
                          }
                    }
                  >
                    {unit.text}
                  </motion.span>
                );
              })}
            </span>
          </Fragment>
        ))}
      </span>
      {trailing}
    </>
  );
}

function revealNode(node: ReactNode, path: string): ReactNode {
  if (typeof node === "string") {
    return <InlineStreamingTextReveal key={path} text={node} />;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) {
    return node;
  }

  if (
    node.props.children === undefined ||
    (typeof node.type === "string" && NON_REVEALABLE_ELEMENTS.has(node.type))
  ) {
    return node;
  }

  return cloneElement(node as ReactElement<{ children?: ReactNode }>, {
    children: revealChildren(node.props.children, `${path}:child`),
  });
}

function revealChildren(children: ReactNode, path: string): ReactNode {
  return Children.map(children, (child, index) => revealNode(child, `${path}:${index}`));
}

export function StreamingMarkdownTextReveal({ children }: { children: ReactNode }) {
  return <>{revealChildren(children, "root")}</>;
}
