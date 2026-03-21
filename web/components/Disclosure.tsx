import React from "react";

export function Disclosure({
  label,
  defaultOpen = false,
  testId,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div className="disclosure" data-testid={testId}>
      <button
        type="button"
        className="disclosure-toggle"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        data-testid={testId ? `${testId}-toggle` : undefined}
      >
        <span className="disclosure-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        {label}
      </button>
      {open ? (
        <div
          className="disclosure-content"
          data-testid={testId ? `${testId}-content` : undefined}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
