import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function Navigation() {
	const links = [{ to: "/", label: "Todos" }];

	return (
		<div className="fixed bottom-0 left-0 z-50 w-full sm:static sm:top-auto sm:bottom-auto">
			<div className="flex flex-row items-center justify-between border-b bg-background px-2 py-1">
				<nav className="flex gap-4 text-lg">
					{links.map(({ to, label }) => (
						<Link key={to} to={to}>
							{label}
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
