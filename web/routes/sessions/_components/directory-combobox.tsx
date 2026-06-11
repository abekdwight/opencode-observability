import { Command } from "cmdk";
import React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover";
import { cn } from "../../../lib/cn";
import { formatDirectory } from "../../../lib/format";

export interface DirectoryFacetOption {
  directory: string;
  count: number;
}

export interface DirectoryComboboxProps {
  options: DirectoryFacetOption[];
  /** Raw directory path, or "" when no directory filter is applied. */
  selected: string;
  onSelect: (directory: string | null) => void;
  className?: string;
}

/** Sentinel for the "no directory filter" item — real paths start with "/". */
const ALL_VALUE = "__all__";

/**
 * Plain substring matching. cmdk's default fuzzy scoring is too loose for
 * paths (scattered characters match unrelated directories).
 */
function substringFilter(
  value: string,
  search: string,
  keywords?: string[],
): number {
  const haystack = `${value} ${keywords?.join(" ") ?? ""}`.toLowerCase();
  return haystack.includes(search.toLowerCase()) ? 1 : 0;
}

const itemClasses = cn(
  "flex cursor-default select-none items-baseline gap-2 rounded-md px-2 py-1.5",
  "text-[0.82em] text-[var(--color-text-primary)] outline-none",
  "aria-selected:bg-[var(--color-bg-elevated)]",
);

/**
 * Searchable directory filter. A native select is unusable once the facet
 * list grows past a screenful, so this renders a cmdk-filtered list inside
 * a popover instead.
 */
export function DirectoryCombobox({
  options,
  selected,
  onSelect,
  className,
}: DirectoryComboboxProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);

  const handleSelect = React.useCallback(
    (value: string) => {
      onSelect(value === ALL_VALUE ? null : value);
      setOpen(false);
    },
    [onSelect],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 text-left",
            selected ? "" : "text-[var(--color-text-secondary)]",
            className,
          )}
          title={selected || undefined}
          data-testid="sessions-directory-combobox"
        >
          {/* Paths are distinguished by their tail, so ellipsize the head:
              outer RTL flips the overflow side, <bdi> keeps the path LTR. */}
          {selected ? (
            <span
              className="truncate flex-1 text-left"
              style={{ direction: "rtl" }}
            >
              <bdi>{formatDirectory(selected)}</bdi>
            </span>
          ) : (
            <span className="truncate flex-1">すべてのディレクトリ</span>
          )}
          <span
            aria-hidden="true"
            className="shrink-0 text-[0.7em] text-[var(--color-text-tertiary)]"
          >
            ▾
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(640px,calc(100vw-2rem))] p-0 overflow-hidden"
      >
        <Command label="ディレクトリで絞り込み" filter={substringFilter}>
          <div className="border-b border-[var(--color-border-subtle)] px-3">
            <Command.Input
              autoFocus
              placeholder="ディレクトリを検索"
              className="h-9 w-full bg-transparent text-[0.82em] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
            />
          </div>
          <Command.List className="max-h-72 overflow-y-auto p-1.5">
            <Command.Empty className="py-4 text-center text-[0.8em] text-[var(--color-text-secondary)]">
              該当するディレクトリがありません
            </Command.Empty>
            <Command.Item
              value={ALL_VALUE}
              onSelect={handleSelect}
              className={itemClasses}
            >
              <SelectedMark active={selected === ""} />
              <span className="flex-1 truncate">すべてのディレクトリ</span>
            </Command.Item>
            {options.map((option) => (
              <Command.Item
                key={option.directory}
                value={option.directory}
                keywords={[formatDirectory(option.directory)]}
                onSelect={handleSelect}
                className={itemClasses}
              >
                <SelectedMark active={selected === option.directory} />
                {/* Full path, wrapped if needed — identification relies on
                    the path tail, so never truncate it. */}
                <span
                  className="flex-1 break-all font-[var(--font-mono)] text-[0.95em]"
                  title={option.directory}
                >
                  {formatDirectory(option.directory)}
                </span>
                <span className="shrink-0 text-[0.85em] tabular-nums text-[var(--color-text-tertiary)]">
                  {option.count}
                </span>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SelectedMark({ active }: { active: boolean }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "w-3 shrink-0 text-[var(--color-text-secondary)]",
        !active && "invisible",
      )}
    >
      ✓
    </span>
  );
}
