import type { ReactNode } from 'react';

import './ui.css';

export type BadgeTone = 'neutral' | 'accent' | 'positive' | 'muted';

/**
 * A small status/label pill. Tone is a semantic name rather than a colour
 * so the palette can change in one place, and every tone stays legible in
 * both the light and dark themes defined in `index.css`.
 *
 * Colour is never the only signal — the label itself always carries the
 * meaning, so this reads the same to someone who can't distinguish the
 * tones.
 */
export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
