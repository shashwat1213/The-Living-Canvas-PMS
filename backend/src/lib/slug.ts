/**
 * Single source of truth for the URL-slug validation rule shared by
 * every module that has one (organizations, properties) — branch-review
 * finding #10 flagged this pattern as independently duplicated across
 * schema files. The frontend's two HTML `pattern="..."` attributes
 * (SignupPage.tsx, PropertiesPage.tsx) intentionally still hardcode this
 * same rule inline: there's no shared package between the two workspaces
 * yet (`packages/shared` is deliberately deferred until the Reservations
 * phase — see DECISIONS.md), and introducing one just for this one regex
 * would be a bigger change than the duplication it removes.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_PATTERN_MESSAGE = 'Use lowercase letters, numbers, and hyphens only.';
