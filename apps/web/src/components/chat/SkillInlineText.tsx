import { Children, cloneElement, Fragment, isValidElement, type ReactNode } from "react";
import type { ServerProviderSkill } from "@t3tools/contracts";

import { formatProviderSkillDisplayName } from "../../providerSkillPresentation";
import {
  CHAT_INLINE_CHIP_CLASS_NAME,
  CHAT_INLINE_CHIP_LABEL_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  SKILL_CHIP_ICON_SVG,
} from "../composerInlineChip";
import { cn } from "~/lib/utils";

const SKILL_TOKEN_REGEX = /(^|\s)\$([a-zA-Z][a-zA-Z0-9:_-]*)(?=\s|$)/g;

type InlineSkill = Pick<ServerProviderSkill, "name" | "displayName">;
type InlineTextRenderer = (text: string) => ReactNode;

export function SkillInlineText(props: {
  text: string;
  skills: ReadonlyArray<InlineSkill>;
  renderText?: InlineTextRenderer | undefined;
}) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  const renderText = props.renderText ?? ((text: string) => text);

  for (const match of props.text.matchAll(SKILL_TOKEN_REGEX)) {
    const prefix = match[1] ?? "";
    const name = match[2] ?? "";
    const start = (match.index ?? 0) + prefix.length;
    const rawText = `$${name}`;
    const skill = props.skills.find((candidate) => candidate.name === name);
    if (!skill) {
      continue;
    }

    if (start > cursor) {
      const text = props.text.slice(cursor, start);
      nodes.push(<Fragment key={`text:${cursor}`}>{renderText(text)}</Fragment>);
    }
    nodes.push(<SkillChip key={`${start}:${name}`} skill={skill} rawText={rawText} />);
    cursor = start + rawText.length;
  }

  if (cursor === 0) {
    return <>{renderText(props.text)}</>;
  }
  if (cursor < props.text.length) {
    nodes.push(<Fragment key={`text:${cursor}`}>{renderText(props.text.slice(cursor))}</Fragment>);
  }
  return <>{nodes}</>;
}

function renderPlainMarkdownTextChildren(
  children: ReactNode,
  renderText: InlineTextRenderer,
): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      return renderText(child);
    }
    if (!isValidElement<{ children?: ReactNode; node?: { tagName?: string } }>(child)) {
      return child;
    }
    const markdownTagName = typeof child.type === "string" ? child.type : child.props.node?.tagName;
    if (markdownTagName === "code" || !("children" in child.props)) {
      return child;
    }
    return cloneElement(
      child,
      undefined,
      renderPlainMarkdownTextChildren(child.props.children, renderText),
    );
  });
}

export function renderSkillInlineMarkdownChildren(
  children: ReactNode,
  skills: ReadonlyArray<InlineSkill>,
  renderText?: InlineTextRenderer,
): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      return <SkillInlineText text={child} skills={skills} renderText={renderText} />;
    }
    if (!isValidElement<{ children?: ReactNode; node?: { tagName?: string } }>(child)) {
      return child;
    }
    // Custom react-markdown components replace the intrinsic type, so also
    // check the hast node they carry.
    const markdownTagName = typeof child.type === "string" ? child.type : child.props.node?.tagName;
    if (markdownTagName === "code") {
      return child;
    }
    if (markdownTagName === "a") {
      return renderText && "children" in child.props
        ? cloneElement(
            child,
            undefined,
            renderPlainMarkdownTextChildren(child.props.children, renderText),
          )
        : child;
    }
    if (!("children" in child.props)) {
      return child;
    }
    return cloneElement(
      child,
      undefined,
      renderSkillInlineMarkdownChildren(child.props.children, skills, renderText),
    );
  });
}

function SkillChip(props: { skill: InlineSkill; rawText: string }) {
  return (
    <span className="inline-flex align-middle leading-none" data-markdown-copy={props.rawText}>
      <span
        className={cn(
          CHAT_INLINE_CHIP_CLASS_NAME,
          "border-fuchsia-500/25 bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-300",
        )}
      >
        <span
          aria-hidden="true"
          className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME}
          dangerouslySetInnerHTML={{ __html: SKILL_CHIP_ICON_SVG }}
        />
        <span className={CHAT_INLINE_CHIP_LABEL_CLASS_NAME}>
          {formatProviderSkillDisplayName(props.skill)}
        </span>
      </span>
    </span>
  );
}
