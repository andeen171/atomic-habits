import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import { useIsDesktop } from "@/lib/use-media-query";
import { cn, isMac } from "@/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import { ListPlus, Plus, Search } from "lucide-react";
import { LogoMark, Wordmark } from "../brand/logo";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Kbd } from "../ui/kbd";
import { Tip } from "../ui/tooltip";
import { NAV, type NavItem, SIDEBAR_ITEMS } from "./nav-items";
import { SyncIndicator } from "./sync-indicator";
import { useNavBadges } from "./use-nav-badges";

/** Desktop sidebar (≥1024px) that collapses to an icon rail at 768–1023px. */
export function Sidebar() {
	const { t, at } = useT();
	const expanded = useIsDesktop();
	const navigate = useNavigate();
	const badges = useNavBadges();
	const setPaletteOpen = useUI((s) => s.setPaletteOpen);
	const openTaskDialog = useUI((s) => s.openTaskDialog);

	return (
		<aside
			aria-label={at("app.mainNav")}
			className={cn(
				"fixed inset-y-0 left-0 z-30 hidden flex-col border-line border-r bg-bg py-5 md:flex",
				expanded ? "w-(--sidebar-width) px-3" : "w-[72px] items-center px-2",
			)}
		>
			<Link
				to="/"
				className={cn("mb-6 rounded-md", expanded ? "px-2.5" : "")}
				aria-label={t("app.name")}
			>
				{expanded ? <Wordmark label={t("app.name")} /> : <LogoMark className="size-8" />}
			</Link>

			{expanded ? (
				<div className="mb-2 flex gap-2 px-0.5">
					<Button className="flex-1 justify-start" onClick={() => navigate({ to: "/habits/new" })}>
						<Plus strokeWidth={2.25} />
						{t("habits.new")}
					</Button>
					<IconButton
						label={t("shortcuts.newTask")}
						variant="secondary"
						size="lg"
						className="size-10"
						onClick={() => openTaskDialog({ mode: "create", date: null })}
					>
						<ListPlus />
					</IconButton>
				</div>
			) : (
				<IconButton
					label={t("habits.new")}
					variant="primary"
					size="lg"
					className="mb-2"
					onClick={() => navigate({ to: "/habits/new" })}
				>
					<Plus strokeWidth={2.25} />
				</IconButton>
			)}

			{expanded ? (
				<button
					type="button"
					onClick={() => setPaletteOpen(true)}
					className="mx-0.5 mb-5 flex h-10 items-center gap-2.5 rounded-full border border-line bg-surface/60 px-3.5 text-ink-subtle text-small transition-colors hover:border-line-strong hover:text-ink-muted"
				>
					<Search className="size-4" />
					<span className="flex-1 text-left">{t("common.search")}</span>
					<Kbd>{isMac ? "⌘K" : "Ctrl K"}</Kbd>
				</button>
			) : (
				<IconButton
					label={t("common.search")}
					className="mb-4"
					onClick={() => setPaletteOpen(true)}
				>
					<Search />
				</IconButton>
			)}

			<nav className="flex flex-col gap-0.5">
				{SIDEBAR_ITEMS.map((key) => (
					<SidebarLink
						key={key}
						item={NAV[key]}
						label={t(`nav.${key}`)}
						expanded={expanded}
						badge={key === "today" ? badges.today : key === "tasks" ? badges.tasks : 0}
					/>
				))}
			</nav>

			<div className={cn("mt-auto flex flex-col gap-0.5", !expanded && "items-center")}>
				<SyncIndicator showLabel={expanded} />
				<SidebarLink item={NAV.settings} label={t("nav.settings")} expanded={expanded} />
			</div>
		</aside>
	);
}

interface SidebarLinkProps {
	item: NavItem;
	label: string;
	expanded: boolean;
	badge?: number;
}

function SidebarLink({ item, label, expanded, badge = 0 }: SidebarLinkProps) {
	const Icon = item.icon;
	const link = (
		<Link
			to={item.to}
			activeOptions={{ exact: item.exact, includeSearch: false }}
			aria-label={expanded ? undefined : label}
			className={cn(
				"group relative flex items-center rounded-md font-medium text-ink-muted text-small transition-colors duration-(--atomic-duration-fast) hover:bg-hover hover:text-ink data-[status=active]:bg-surface data-[status=active]:text-ink data-[status=active]:shadow-card dark:data-[status=active]:bg-hover",
				expanded ? "h-10 gap-3 px-3" : "size-11 justify-center",
			)}
		>
			<Icon
				className="size-[18px] shrink-0 transition-colors group-data-[status=active]:text-accent"
				strokeWidth={1.9}
			/>
			{expanded ? <span className="flex-1 truncate">{label}</span> : null}
			{badge > 0 ? (
				expanded ? (
					<span className="min-w-5 rounded-full bg-sunken px-1.5 text-center font-semibold text-ink-muted text-tiny tabular-nums leading-5 group-data-[status=active]:bg-accent-soft group-data-[status=active]:text-ink">
						{badge}
					</span>
				) : (
					<span
						aria-hidden="true"
						className="absolute top-2 right-2 size-2 rounded-full bg-accent ring-2 ring-bg"
					/>
				)
			) : null}
		</Link>
	);
	return expanded ? (
		link
	) : (
		<Tip label={label} side="right">
			{link}
		</Tip>
	);
}
