const INLINE_CHIP_CLASS_NAME =
  "inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-accent/40 px-1.5 py-px font-medium text-[12px] leading-[1.1] text-foreground align-middle";

export const CHAT_INLINE_CHIP_CLASS_NAME = INLINE_CHIP_CLASS_NAME;

export const COMPOSER_INLINE_CHIP_CLASS_NAME = `${INLINE_CHIP_CLASS_NAME} select-none`;

export const COMPOSER_INLINE_CHIP_ICON_CLASS_NAME = "size-3.5 shrink-0 opacity-85";

export const CHAT_INLINE_CHIP_LABEL_CLASS_NAME = "truncate leading-tight";

export const COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME = `${CHAT_INLINE_CHIP_LABEL_CLASS_NAME} select-none`;

const CHAT_INLINE_METADATA_CHIP_CLASS_NAME =
  "inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-[9px] border border-border/60 bg-foreground/[0.045] px-1.5 py-0.5 font-normal text-[12px] leading-[1.1] text-foreground/80 align-middle transition-colors hover:bg-foreground/[0.065]";

const COMPOSER_INLINE_METADATA_CHIP_CLASS_NAME = `${CHAT_INLINE_METADATA_CHIP_CLASS_NAME} select-none`;

export const CHAT_INLINE_FILE_TAG_CHIP_CLASS_NAME = CHAT_INLINE_METADATA_CHIP_CLASS_NAME;
export const COMPOSER_INLINE_FILE_TAG_CHIP_CLASS_NAME = COMPOSER_INLINE_METADATA_CHIP_CLASS_NAME;

export const CHAT_INLINE_SKILL_CHIP_CLASS_NAME = CHAT_INLINE_METADATA_CHIP_CLASS_NAME;
export const COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME = COMPOSER_INLINE_METADATA_CHIP_CLASS_NAME;

export const COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME =
  "ml-0.5 inline-flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/72 transition-colors hover:bg-foreground/6 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
