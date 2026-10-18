import { router } from "expo-router";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { useT } from "@/lib/i18n";

export default function NotFoundScreen() {
	const t = useT();
	return (
		<Screen back>
			<EmptyState
				title={t.t("notFound.title")}
				body={t.t("notFound.body")}
				action={<Button label={t.t("today.backToToday")} size="lg" onPress={() => router.replace("/")} />}
			/>
		</Screen>
	);
}
