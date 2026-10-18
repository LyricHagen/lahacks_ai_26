// The only place icons may live. CLAUDE.md: no decorative icons, never install an icon package.
// Add an icon here only when comprehension genuinely needs it, as a minimal inline SVG stroke
// icon (1.5px stroke, currentColor, 16x16 viewBox, aria-hidden unless it is the only label).

import type { SVGProps } from "react";

/** A small cross on the remove button of a chip. The button also carries an aria-label. */
export function IconClose(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
