"use client";

import { useLayoutEffect, useRef } from "react";

import { acquireBrowserSurface } from "./browserSurfaceStore";

export function BrowserSurfaceSlot(props: {
  readonly tabId: string;
  readonly visible: boolean;
  readonly cornerRadius?: number;
  readonly layoutVersion?: string | number;
  readonly className?: string;
  readonly fitSourceContent?: boolean;
}) {
  const {
    tabId,
    visible,
    cornerRadius = 0,
    layoutVersion,
    className,
    fitSourceContent = false,
  } = props;
  const elementRef = useRef<HTMLDivElement | null>(null);
  const presentationRef = useRef({ visible, cornerRadius });
  const updateRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let lease = acquireBrowserSurface(tabId, fitSourceContent);
    let frameId: number | null = null;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const presentation = presentationRef.current;
      const presented = lease.present(
        {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        },
        presentation.visible && rect.width > 0 && rect.height > 0,
        presentation.cornerRadius,
      );
      if (presentation.visible && !presented) {
        lease.release();
        lease = acquireBrowserSurface(tabId, fitSourceContent);
        lease.present(
          {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height)),
          },
          rect.width > 0 && rect.height > 0,
          presentation.cornerRadius,
        );
      }
    };
    const scheduleVisibleUpdate = () => {
      if (!presentationRef.current.visible || frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        update();
      });
    };
    updateRef.current = update;
    update();
    const observer = new ResizeObserver(scheduleVisibleUpdate);
    observer.observe(element);
    window.addEventListener("resize", scheduleVisibleUpdate);
    window.addEventListener("scroll", scheduleVisibleUpdate, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleVisibleUpdate);
      window.removeEventListener("scroll", scheduleVisibleUpdate, true);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      if (updateRef.current === update) updateRef.current = null;
      lease.release();
    };
  }, [fitSourceContent, tabId]);

  useLayoutEffect(() => {
    presentationRef.current = { visible, cornerRadius };
    updateRef.current?.();
  }, [cornerRadius, layoutVersion, visible]);

  return <div ref={elementRef} className={className} data-browser-surface-slot={tabId} />;
}
