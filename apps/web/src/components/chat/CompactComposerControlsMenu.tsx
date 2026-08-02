import { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { memo, type ReactNode } from "react";
import { EllipsisIcon, ListTodoIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  FLOATING_SQUIRCLE_ITEM_CLASS_NAME,
  FLOATING_SQUIRCLE_SURFACE_CLASS_NAME,
} from "../ui/floatingSquircle";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  activePlan: boolean;
  interactionMode: ProviderInteractionMode;
  planSidebarLabel: string;
  planSidebarOpen: boolean;
  runtimeMode: RuntimeMode;
  showInteractionModeToggle: boolean;
  traitsMenuContent?: ReactNode;
  onToggleInteractionMode: () => void;
  onTogglePlanSidebar: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80"
            aria-label="More composer controls"
          />
        }
      >
        <EllipsisIcon aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuPopup align="start" className={FLOATING_SQUIRCLE_SURFACE_CLASS_NAME}>
        {props.traitsMenuContent ? (
          <>
            {props.traitsMenuContent}
            <MenuDivider />
          </>
        ) : null}
        {props.showInteractionModeToggle ? (
          <>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Mode</div>
            <MenuRadioGroup
              value={props.interactionMode}
              onValueChange={(value) => {
                if (!value || value === props.interactionMode) return;
                props.onToggleInteractionMode();
              }}
            >
              <MenuRadioItem className={FLOATING_SQUIRCLE_ITEM_CLASS_NAME} value="default">
                Chat
              </MenuRadioItem>
              <MenuRadioItem className={FLOATING_SQUIRCLE_ITEM_CLASS_NAME} value="plan">
                Plan
              </MenuRadioItem>
            </MenuRadioGroup>
            <MenuDivider />
          </>
        ) : null}
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Access</div>
        <MenuRadioGroup
          value={props.runtimeMode}
          onValueChange={(value) => {
            if (!value || value === props.runtimeMode) return;
            props.onRuntimeModeChange(value as RuntimeMode);
          }}
        >
          <MenuRadioItem className={FLOATING_SQUIRCLE_ITEM_CLASS_NAME} value="approval-required">
            Supervised
          </MenuRadioItem>
          <MenuRadioItem className={FLOATING_SQUIRCLE_ITEM_CLASS_NAME} value="auto-accept-edits">
            Auto-accept edits
          </MenuRadioItem>
          <MenuRadioItem className={FLOATING_SQUIRCLE_ITEM_CLASS_NAME} value="auto">
            Auto
          </MenuRadioItem>
          <MenuRadioItem className={FLOATING_SQUIRCLE_ITEM_CLASS_NAME} value="full-access">
            Full access
          </MenuRadioItem>
        </MenuRadioGroup>
        {props.activePlan ? (
          <>
            <MenuDivider />
            <MenuItem
              className={FLOATING_SQUIRCLE_ITEM_CLASS_NAME}
              onClick={props.onTogglePlanSidebar}
            >
              <ListTodoIcon className="size-4 shrink-0" />
              {props.planSidebarOpen
                ? `Hide ${props.planSidebarLabel.toLowerCase()} sidebar`
                : `Show ${props.planSidebarLabel.toLowerCase()} sidebar`}
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
});
