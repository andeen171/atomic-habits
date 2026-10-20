import { SyncSection } from "../settings/sync-section";

/**
 * Settings → "Account & sync" (Annex C §4): signed out, the sign-in and
 * create-account buttons with the "Atomic Cloud · Change" server line;
 * signed in, the avatar, plan badge, sync status, Sync now and "Manage
 * account →". The settings page hides it in the artifact build.
 * Owner: T5. Phase 1B: the v1 sync section, unchanged.
 */
export function AccountSection() {
	return <SyncSection />;
}
