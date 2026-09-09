/**
 * Inline stroke icons for the app shell navigation. Kept dependency-free
 * (no icon package) and driven by `currentColor` so they inherit the nav
 * link's active/hover color. 20px on a 24px viewBox, 1.75 stroke — the
 * density leading PMS sidebars use.
 */
import type { ReactNode } from 'react';

type IconName =
  | 'brand'
  | 'dashboard'
  | 'properties'
  | 'guests'
  | 'team'
  | 'activity'
  | 'logout'
  | 'menu';

const PATHS: Record<IconName, ReactNode> = {
  brand: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 21v-6h6v6" />
      <path d="M9 10h.01M15 10h.01" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  properties: (
    <>
      <path d="M3 21V9l6-4 6 4" />
      <path d="M15 21V5l6 4v12" />
      <path d="M3 21h18" />
      <path d="M7 13h.01M7 17h.01" />
    </>
  ),
  guests: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 3.5a3 3 0 0 1 0 5.8" />
      <path d="M18 14a5.5 5.5 0 0 1 3 4.9" />
    </>
  ),
  team: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  activity: (
    <>
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </>
  ),
  logout: (
    <>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="M10 17l-5-5 5-5" />
      <path d="M5 12h12" />
    </>
  ),
  menu: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </>
  ),
};

export function NavIcon({ name }: { name: IconName }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
