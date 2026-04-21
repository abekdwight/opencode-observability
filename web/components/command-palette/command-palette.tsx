import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import { useMermaidPreferences } from "../mermaid-preferences-provider";
import { useTheme } from "../../hooks/use-theme";
import { cn } from "../../lib/cn";
import { actionCommands, navigationCommands } from "./commands";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { setTheme, resolvedTheme } = useTheme();
  const { toggleMermaidTheme } = useMermaidPreferences();

  const handleSelect = (commandId: string) => {
    switch (commandId) {
      case "go-dashboard":
        navigate("/");
        break;
      case "go-monitor":
        navigate("/monitor");
        break;
      case "go-search":
        navigate("/search");
        break;
      case "go-directories":
        navigate("/directories");
        break;
      case "go-tool-errors":
        navigate("/tool-errors");
        break;
      case "toggle-theme":
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
        break;
      case "toggle-mermaid-theme":
        toggleMermaidTheme();
        break;
    }
    onOpenChange(false);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-command-palette)] bg-black/50" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-[20%] z-[var(--z-command-palette)] w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          <Command
            className="flex h-full w-full flex-col"
            label="Command palette"
          >
            <div className="flex items-center border-b border-[var(--color-border-default)] px-3">
              <span className="mr-2 text-[var(--color-text-tertiary)]">
                &#x2318;
              </span>
              <Command.Input
                placeholder="Type a command or search..."
                className="flex h-10 w-full bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
              />
            </div>
            <Command.List className="max-h-72 overflow-y-auto p-2">
              <Command.Empty className="py-6 text-center text-sm text-[var(--color-text-secondary)]">
                No results found
              </Command.Empty>
              <Command.Group
                heading="Navigation"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-[var(--color-text-secondary)]"
              >
                {navigationCommands.map((cmd) => (
                  <Command.Item
                    key={cmd.id}
                    value={cmd.label}
                    keywords={cmd.keywords}
                    onSelect={() => handleSelect(cmd.id)}
                    className="flex cursor-default select-none items-center rounded-md px-2 py-1.5 text-sm text-[var(--color-text-primary)] outline-none aria-selected:bg-[var(--color-bg-elevated)]"
                  >
                    {cmd.label}
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Separator className="my-1 h-px bg-[var(--color-border-default)]" />
              <Command.Group
                heading="Actions"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-[var(--color-text-secondary)]"
              >
                {actionCommands.map((cmd) => (
                  <Command.Item
                    key={cmd.id}
                    value={cmd.label}
                    keywords={cmd.keywords}
                    onSelect={() => handleSelect(cmd.id)}
                    className="flex cursor-default select-none items-center rounded-md px-2 py-1.5 text-sm text-[var(--color-text-primary)] outline-none aria-selected:bg-[var(--color-bg-elevated)]"
                  >
                    {cmd.label}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
