import { type RefObject, useLayoutEffect, useRef, useState } from "react";

/** Width of an element, kept current with a ResizeObserver. */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
	const ref = useRef<T>(null);
	const [width, setWidth] = useState(0);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		setWidth(el.clientWidth);
		const observer = new ResizeObserver(([entry]) => {
			if (entry) setWidth(Math.round(entry.contentRect.width));
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	return [ref, width];
}
