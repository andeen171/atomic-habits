import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import { principles } from "@atomic/core";
import { useLocale } from "@atomic/core/react";
import { Dialog, DialogBody, DialogContent, DialogHeader } from "../ui/dialog";

const LAWS = [1, 2, 3, 4] as const;

/** A short explainer of the four laws, built from the shared principles. */
export function FourLawsDialog() {
	const { t, at } = useT();
	const locale = useLocale();
	const open = useUI((s) => s.fourLawsOpen);
	const setOpen = useUI((s) => s.setFourLawsOpen);
	const all = principles(locale);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent>
				<DialogHeader title={at("settings.fourLaws")} description={at("settings.fourLawsIntro")} />
				<DialogBody className="flex flex-col gap-3 pb-6">
					{LAWS.map((law) => {
						const principle = all.find((p) => p.law === law);
						return (
							<div key={law} className="rounded-lg border border-line p-4">
								<div className="flex items-center gap-3">
									<span className="grid size-7 place-items-center rounded-full bg-accent-soft font-semibold text-ink text-small dark:text-accent-text">
										{law}
									</span>
									<div>
										<p className="font-semibold text-ink">{t(`law.${law}.name`)}</p>
										<p className="text-ink-subtle text-tiny uppercase tracking-wider">
											{t(`law.${law}.stage`)} · {t(`law.${law}.inverse`)}
										</p>
									</div>
								</div>
								{principle ? (
									<p className="mt-3 text-ink-muted text-small">
										<span className="font-medium text-ink">{principle.title}. </span>
										{principle.body}
									</p>
								) : null}
							</div>
						);
					})}
				</DialogBody>
			</DialogContent>
		</Dialog>
	);
}
