import {
  CloudUploadIcon,
  DatabaseIcon,
  FigmaIcon,
  FileTextIcon,
  GithubIcon,
  GlobeIcon,
  ImageIcon,
  MonitorIcon,
  PresentationIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  SparklesIcon,
  Table2Icon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { COMPOSER_INLINE_CHIP_ICON_CLASS_NAME } from "./composerInlineChip";

const SKILL_ICON_RULES: ReadonlyArray<readonly [RegExp, LucideIcon]> = [
  [/\b(?:imagegen|image gen|image to code|visualize|creative production)\b/u, ImageIcon],
  [/\b(?:browser|chrome|web|research|search)\b/u, GlobeIcon],
  [/\b(?:computer use|desktop|windows|macos|screen)\b/u, MonitorIcon],
  [/\b(?:documents?|docs?|word|notion|pdf)\b/u, FileTextIcon],
  [/\b(?:spreadsheets?|excel|sheets?|data analytics)\b/u, Table2Icon],
  [/\b(?:presentations?|slides?)\b/u, PresentationIcon],
  [/\b(?:github|git)\b/u, GithubIcon],
  [/\bfigma\b/u, FigmaIcon],
  [/\b(?:security|threat|vulnerability)\b/u, ShieldCheckIcon],
  [/\b(?:supabase|postgres|database|sql)\b/u, DatabaseIcon],
  [/\b(?:sites?|deploy|vercel|cloudflare|hosting)\b/u, CloudUploadIcon],
  [/\b(?:ios|mobile|expo|android|swiftui)\b/u, SmartphoneIcon],
  [/\b(?:code|developer|debug|test)\b/u, TerminalIcon],
];

function iconForSkill(skillName: string, skillLabel?: string): LucideIcon {
  const identity = `${skillName} ${skillLabel ?? ""}`.toLowerCase().replace(/[:_/-]+/gu, " ");
  return SKILL_ICON_RULES.find(([pattern]) => pattern.test(identity))?.[1] ?? SparklesIcon;
}

export function SkillChipIcon(props: {
  readonly className?: string;
  readonly skillLabel?: string;
  readonly skillName: string;
}) {
  const Icon = iconForSkill(props.skillName, props.skillLabel);
  return (
    <Icon
      aria-hidden
      className={cn(
        COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
        "text-muted-foreground/85",
        props.className,
      )}
    />
  );
}
