import type { LinkProps } from "@tanstack/react-router";
import {
	ChartColumn,
	CircleUserRound,
	ClipboardList,
	ListChecks,
	type LucideIcon,
	NotebookPen,
	Orbit,
	Settings,
	Sprout,
	Sun,
	UserRound,
} from "lucide-react";

export type NavKey =
	| "today"
	| "habits"
	| "tasks"
	| "identity"
	| "journal"
	| "insights"
	| "scorecard"
	| "settings"
	| "you"
	| "account";

export interface NavItem {
	key: NavKey;
	to: NonNullable<LinkProps["to"]>;
	icon: LucideIcon;
	exact?: boolean;
}

export const NAV: Record<NavKey, NavItem> = {
	today: { key: "today", to: "/", icon: Sun, exact: true },
	habits: { key: "habits", to: "/habits", icon: Orbit },
	tasks: { key: "tasks", to: "/tasks", icon: ListChecks },
	identity: { key: "identity", to: "/identity", icon: Sprout },
	journal: { key: "journal", to: "/journal", icon: NotebookPen },
	insights: { key: "insights", to: "/insights", icon: ChartColumn },
	scorecard: { key: "scorecard", to: "/scorecard", icon: ClipboardList },
	settings: { key: "settings", to: "/settings", icon: Settings },
	you: { key: "you", to: "/you", icon: CircleUserRound },
	// Reached from Settings and the You screen; not in the sidebar (spec §5.10).
	account: { key: "account", to: "/account", icon: UserRound },
};

export const SIDEBAR_ITEMS: NavKey[] = [
	"today",
	"habits",
	"tasks",
	"identity",
	"journal",
	"insights",
	"scorecard",
];
export const YOU_ITEMS: NavKey[] = ["identity", "journal", "insights", "scorecard", "settings"];
