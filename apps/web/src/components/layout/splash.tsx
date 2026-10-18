import { LogoMark } from "../brand/logo";

/** Shown until the store is hydrated (matches the boot splash in index.html). */
export function Splash() {
	return (
		<div className="fixed inset-0 grid place-items-center" aria-hidden>
			<LogoMark className="size-14 animate-pulse" />
		</div>
	);
}
