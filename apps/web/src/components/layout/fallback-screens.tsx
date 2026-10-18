import { Link } from "@tanstack/react-router";
import { useT } from "@/lib/messages";
import { LogoMark } from "../brand/logo";
import { Button } from "../ui/button";
import { OrbitIllustration } from "../ui/empty-state";

export function NotFoundScreen() {
	const { t } = useT();
	return (
		<div className="grid min-h-dvh place-items-center px-6">
			<div className="flex max-w-md flex-col items-center text-center">
				<OrbitIllustration className="mb-4" />
				<p className="font-display text-[5rem] text-ink-subtle leading-none">404</p>
				<h1 className="mt-2 font-display text-ink text-title">{t("notFound.title")}</h1>
				<p className="mt-2 text-ink-muted">{t("notFound.body")}</p>
				<Button asChild className="mt-6">
					<Link to="/">{t("today.backToToday")}</Link>
				</Button>
			</div>
		</div>
	);
}

export function ErrorScreen({ error }: { error: unknown }) {
	const { t } = useT();
	if (error) console.warn("[atomic] Render error", error);
	return (
		<div className="grid min-h-dvh place-items-center px-6">
			<div className="flex max-w-md flex-col items-center text-center">
				<LogoMark className="mb-6 size-12" />
				<h1 className="font-display text-ink text-title">{t("error.title")}</h1>
				<p className="mt-2 text-ink-muted">{t("error.body")}</p>
				<Button className="mt-6" onClick={() => window.location.reload()}>
					{t("error.reload")}
				</Button>
			</div>
		</div>
	);
}
