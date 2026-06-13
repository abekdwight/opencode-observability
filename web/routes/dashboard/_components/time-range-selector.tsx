import React from "react";
import { Button } from "../../../components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import {
  applyDashboardDraftSelection,
  cancelDashboardDraftSelection,
  type DashboardPresetId,
  type DashboardSelectionControllerState,
  setDashboardDraftDates,
  setDashboardDraftPreset,
} from "../../../lib/dashboard-selection";
import { PRESET_OPTIONS } from "../_lib/constants";
import { getTimezoneLabel } from "../_lib/formatters";

export function TimeRangeSelector({
  controller,
  onApply,
  onCancel,
}: {
  controller: DashboardSelectionControllerState;
  onApply: (controller: DashboardSelectionControllerState) => void;
  onCancel: (controller: DashboardSelectionControllerState) => void;
}) {
  const [isPopoverOpen, setIsPopoverOpen] = React.useState(false);
  const [localController, setLocalController] = React.useState(controller);

  // Sync local controller when applied selection changes externally
  React.useEffect(() => {
    setLocalController(controller);
  }, [controller]);

  const handlePresetChange = (preset: DashboardPresetId) => {
    const nextController = setDashboardDraftPreset(localController, preset);
    setLocalController(nextController);
    if (preset === "custom") {
      setIsPopoverOpen(true);
    } else {
      // Auto-apply preset selections
      const applied = applyDashboardDraftSelection(nextController);
      if (!applied.validationError) {
        onApply(applied);
      }
    }
  };

  const handleChangeDates = (dates: { start?: string; end?: string }) => {
    setLocalController(setDashboardDraftDates(localController, dates));
  };

  const handleApply = () => {
    const applied = applyDashboardDraftSelection(localController);
    if (applied.validationError) {
      setLocalController(applied);
    } else {
      onApply(applied);
      setIsPopoverOpen(false);
    }
  };

  const handleCancel = () => {
    const cancelled = cancelDashboardDraftSelection(localController);
    setLocalController(cancelled);
    onCancel(cancelled);
    setIsPopoverOpen(false);
  };

  const isCustom = localController.draftSelection.preset === "custom";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <Select
          value={localController.draftSelection.preset}
          onValueChange={(value) =>
            handlePresetChange(value as DashboardPresetId)
          }
        >
          <SelectTrigger
            className="w-40"
            data-testid="dashboard-time-preset"
            aria-label="Time range preset"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESET_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!isCustom && (
          <span
            className="text-xs text-[var(--color-text-secondary)]"
            data-testid="dashboard-preset-helper"
          >
            {
              PRESET_OPTIONS.find(
                (o) => o.value === localController.draftSelection.preset,
              )?.helper
            }
          </span>
        )}
      </div>

      {isCustom && (
        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-elevated)]"
              data-testid="dashboard-custom-range-trigger"
              aria-expanded={isPopoverOpen}
              aria-haspopup="dialog"
            >
              {localController.draftSelection.start &&
              localController.draftSelection.end
                ? `${localController.draftSelection.start} → ${localController.draftSelection.end}`
                : "Select dates..."}
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-80"
            align="start"
            aria-label="Custom date range"
          >
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                  Start date
                </span>
                <input
                  type="date"
                  className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-sm"
                  value={localController.draftSelection.start}
                  onChange={(e) => handleChangeDates({ start: e.target.value })}
                  data-testid="dashboard-range-start"
                  aria-label="Start date"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                  End date
                </span>
                <input
                  type="date"
                  className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-sm"
                  value={localController.draftSelection.end}
                  onChange={(e) => handleChangeDates({ end: e.target.value })}
                  data-testid="dashboard-range-end"
                  aria-label="End date"
                />
              </label>
            </div>
            {localController.validationError && (
              <p
                className="mt-2 text-xs text-[var(--color-error-text)]"
                data-testid="dashboard-range-error"
              >
                {localController.validationError}
              </p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCancel}
                data-testid="dashboard-range-cancel"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleApply}
                data-testid="dashboard-range-apply"
              >
                Apply
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}

      <span
        className="text-xs text-[var(--color-text-tertiary)]"
        data-testid="dashboard-timezone-label"
      >
        {getTimezoneLabel()}
      </span>
    </div>
  );
}
