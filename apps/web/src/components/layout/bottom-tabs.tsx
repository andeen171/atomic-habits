import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { NAV, type NavItem, YOU_ITEMS } from "./nav-items";
import { useNavBadges } from "./use-nav-badges";

/** Mobile tab bar (<768px) with the center ⊕ create button. */
export function BottomTabs() {
	const { t, at } = useT();
	const badges = useNavBadges();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const setCreateOpen = useUI((s) => s.setCreateSheetOpen);
	const youActive =
		pathname === "/you" ||
		pathname.startsWith(NAV.account.to) ||
		YOU_ITEMS.some((key) => pathname.startsWith(NAV[key].to));

	return (
		<nav
			aria-label={at("app.mainNav")}
			className="fixed inset-x-0 bottom-0 z-30 border-line border-t bg-bg/90 pb-safe backdrop-blur-xl md:hidden"
		>
			<div className="mx-auto grid h-(--tabbar-height) max-w-md grid-cols-5 items-center px-2">
				<TabLink item={NAV.today} label={t("nav.today")} badge={badges.today} />
				<TabLink item={NAV.habits} label={t("nav.habits")} />
				<div className="flex justify-center">
					<button
						type="button"
						aria-label={at("create.title")}
						onClick={() => setCreateOpen(true)}
						className="grid size-12 place-items-center rounded-full bg-accent text-on-accent shadow-[0_6px_20px_-6px_var(--accent)] transition-transform active:scale-95"
					>
						<Plus className="size-6" strokeWidth={2.25} />
					</button>
				</div>
				<TabLink item={NAV.tasks} label={t("nav.tasks")} badge={badges.tasks} />
				<TabLink item={NAV.you} label={t("nav.you")} forceActive={youActive} />
			</div>
		</nav>
	);
}

interface TabLinkProps {
	item: NavItem;
	label: string;
	badge?: number;
	forceActive?: boolean;
}

function TabLink({ item, label, badge = 0, forceActive }: TabLinkProps) {
	const { t } = useT();
	const Icon = item.icon;
	return (
		<Link
			to={item.to}
			activeOptions={{ exact: item.exact, includeSearch: false }}
			// The badge sits before the label in the DOM: name it "Tasks, 8 to do", not "8 Tasks".
			aria-label={badge > 0 ? t("nav.withCount", { label, count: badge }) : undefined}
			data-force-active={forceActive ? "" : undefined}
			className={cn(
				"group relative flex h-full flex-col items-center justify-center gap-1 font-medium text-[11px] text-ink-subtle transition-colors data-[status=active]:text-ink",
				forceActive && "text-ink",
			)}
		>
			<span className="relative">
				<Icon
					className={cn(
						"size-[22px] transition-colors group-data-[status=active]:text-accent",
						forceActive && "text-accent",
					)}
					strokeWidth={1.9}
				/>
				{badge > 0 ? (
					<span
						aria-hidden="true"
						className="-top-1.5 -right-2.5 absolute min-w-4 rounded-full bg-accent px-1 text-center font-semibold text-[10px] text-on-accent tabular-nums leading-4"
					>
						{badge}
					</span>
				) : null}
			</span>
			<span className="max-w-full truncate">{label}</span>
		</Link>
	);
}
