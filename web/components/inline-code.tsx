import React from "react";

export interface InlineCodeProps {
  children: React.ReactNode;
}

/**
 * Inline `<code>` rendered as a small chip. Self-contained: parent prose
 * containers must not style `code` via descendant selectors — this component
 * owns its visual presentation.
 */
export const InlineCode = React.memo(function InlineCode({
  children,
}: InlineCodeProps) {
  return (
    <code
      data-inline-code
      className="rounded-[var(--radius-sm)] bg-[var(--color-bg-code)] px-[6px] py-[1px] [font-family:var(--font-mono)] text-[0.88em] text-[var(--color-text-primary)]"
    >
      {children}
    </code>
  );
});
