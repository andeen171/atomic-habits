import type { LinkProps } from "@tanstack/react-router";
import {
	ChartColumn,
	CircleUserRound,
	ClipboardList,
	ListChecks,
	type LucideIcon,
	Orbit,
	Settings,
	Sprout,
	Sun,
} from "lucide-react";

export type NavKey = "today" | "habits" | "tasks" | "identity" | "insights" | "scorecard" | "settings" | "you";

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
	insights: { key: "insights", to: "/insights", icon: ChartColumn },
	scorecard: { key: "scorecard", to: "/scorecard", icon: ClipboardList },
	settings: { key: "settings", to: "/settings", icon: Settings },
	you: { key: "you", to: "/you", icon: CircleUserRound },
};

export const SIDEBAR_ITEMS: NavKey[] = ["today", "habits", "tasks", "identity", "insights", "scorecard"];
export const YOU_ITEMS: NavKey[] = ["identity", "insights", "scorecard", "settings"];
