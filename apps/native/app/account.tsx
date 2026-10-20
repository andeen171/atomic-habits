import { AccountSummary } from "@/components/account/account-summary";
import { Screen, ScreenTitle } from "@/components/ui/screen";
import { useT } from "@/lib/i18n";

/**
 * The account page (Annex C §5): plan, usage, profile, security, data and
 * the danger zone. Owner: T5. Phase 1B: a placeholder with the v1 sync
 * section.
 */
export default function AccountScreen() {
	const t = useT();
	return (
		<Screen back title={t.t("nav.account")} keyboard testID="account-screen">
			<ScreenTitle title={t.t("nav.account")} />
			<AccountSummary />
		</Screen>
	);
}
