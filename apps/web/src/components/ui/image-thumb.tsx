import { cn } from "@/lib/utils";
import { ImageOff } from "lucide-react";
import { type ReactNode, useState } from "react";

export interface ImageThumbProps {
	/** Object URL or data URL; null shows the placeholder. */
	src: string | null;
	/** Describes the photo; "" marks it decorative. */
	alt: string;
	/** Edge in px (square). Default 64. */
	size?: number;
	/** Shown when there is no `src` or it fails to load ("Photo not on this device yet"). */
	placeholder?: ReactNode;
	/** Makes the thumbnail a button (opens the viewer). Its name is `label`, else `alt`. */
	onClick?(): void;
	label?: string;
	className?: string;
}

/**
 * A square, cropped photo thumbnail. Lazy-loaded; a missing or broken image
 * shows the placeholder (an icon by default) instead of a broken-image box.
 */
export function ImageThumb({
	src,
	alt,
	size = 64,
	placeholder,
	onClick,
	label,
	className,
}: ImageThumbProps) {
	// The source that failed to load; a new `src` gets a fresh try.
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	const failed = src !== null && failedSrc === src;
	const box = cn(
		"relative grid shrink-0 place-items-center overflow-hidden rounded-md bg-sunken text-ink-subtle",
		className,
	);
	const style = { width: size, height: size };
	const content =
		src && !failed ? (
			<img
				src={src}
				alt={onClick ? "" : alt}
				loading="lazy"
				decoding="async"
				draggable={false}
				onError={() => setFailedSrc(src)}
				className="size-full object-cover"
			/>
		) : (
			(placeholder ?? <ImageOff aria-hidden="true" className="size-1/3" />)
		);

	if (onClick) {
		return (
			<button
				type="button"
				aria-label={label ?? alt}
				onClick={onClick}
				style={style}
				className={cn(
					box,
					"transition-[box-shadow,transform] duration-(--atomic-duration-fast) hover:ring-2 hover:ring-line-strong active:scale-[0.98]",
				)}
			>
				{content}
			</button>
		);
	}
	return (
		<span
			role={src && !failed ? undefined : "img"}
			aria-label={src && !failed ? undefined : alt || undefined}
			style={style}
			className={box}
		>
			{content}
		</span>
	);
}
