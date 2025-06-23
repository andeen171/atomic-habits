import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { HomeIcon } from "lucide-react";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function Navigation() {
	const links = [{ to: "/", label: "Todos" }];
	const isActive = (to: string) => location.pathname === to;

	return (
		<div className="fixed bottom-0 left-0 z-50 w-full sm:static sm:top-auto sm:bottom-auto">
			<div className="flex flex-row items-center justify-between border-t bg-background px-2 py-3 sm:border-b sm:py-1">
				<nav className="flex gap-4 text-2xl">
					{links.map(({ to, label }) => (
						<Link key={to} to={to} className="h-full w-full">
							<Button
								variant={isActive(to) ? "default" : "ghost"}
								className="flex min-w-[80px] flex-col items-center gap-0 py-7 sm:py-5.5"
							>
								<HomeIcon />
								{label}
							</Button>
						</Link>
					))}
				</nav>
				<div className="flex items-center gap-2">
					<ModeToggle />
					<Button variant={"outline"}>
						<Link key={"/checkhealth"} to={"/checkhealth"}>
							Check health
						</Link>
					</Button>
					<UserMenu />
				</div>
			</div>
		</div>
	);
}
