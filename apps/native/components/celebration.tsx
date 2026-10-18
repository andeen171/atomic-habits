import { HABIT_COLORS } from "@atomic/core";
import { useAtomic } from "@atomic/core/react";
import { habitColors } from "@atomic/core/theme";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
	Easing,
	type SharedValue,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useReduceMotion } from "@/lib/motion";
import { useUI } from "@/lib/ui-store";

const COUNT = 42;
const DURATION = 2200;

interface Particle {
	id: number;
	color: string;
	size: number;
	ring: boolean;
	vx: number;
	vy: number;
	spin: number;
	delay: number;
}

/** One-time "atoms" confetti for a perfect day (respects settings and reduce motion). */
export function Celebration() {
	const token = useUI((s) => s.celebration);
	const enabled = useAtomic((s) => s.settings.celebrations);
	const reduceMotion = useReduceMotion();
	const [active, setActive] = useState(0);
	useEffect(() => {
		if (token && enabled && !reduceMotion) setActive(token);
	}, [token, enabled, reduceMotion]);
	if (!active) return null;
	return <Confetti key={active} onDone={() => setActive(0)} />;
}

function Confetti({ onDone }: { onDone: () => void }) {
	const { width, height } = useWindowDimensions();
	const progress = useSharedValue(0);
	const particles = useMemo<Particle[]>(() => {
		const hues = HABIT_COLORS.filter((c) => c !== "stone");
		return Array.from({ length: COUNT }, (_, id) => {
			const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
			const speed = 0.55 + Math.random() * 0.6;
			const hue = hues[id % hues.length] ?? "ember";
			return {
				id,
				color: habitColors[hue].base,
				size: 6 + Math.random() * 8,
				ring: id % 3 === 0,
				vx: Math.cos(angle) * speed * width * 0.9,
				vy: Math.sin(angle) * speed * height * 0.75,
				spin: (Math.random() - 0.5) * 720,
				delay: Math.random() * 0.08,
			};
		});
	}, [width, height]);

	const doneRef = useRef(onDone);
	doneRef.current = onDone;
	useEffect(() => {
		const finish = () => doneRef.current();
		progress.value = withTiming(1, { duration: DURATION, easing: Easing.linear }, (finished) => {
			if (finished) scheduleOnRN(finish);
		});
	}, [progress]);

	return (
		<View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden>
			{particles.map((p) => (
				<Atom key={p.id} particle={p} progress={progress} originX={width / 2} originY={height * 0.42} gravity={height * 1.5} />
			))}
		</View>
	);
}

function Atom({
	particle,
	progress,
	originX,
	originY,
	gravity,
}: {
	particle: Particle;
	progress: SharedValue<number>;
	originX: number;
	originY: number;
	gravity: number;
}) {
	const style = useAnimatedStyle(() => {
		const t = Math.max(0, progress.value - particle.delay) / (1 - particle.delay);
		const time = t * 1.6;
		const x = originX + particle.vx * time * (1 - t * 0.35);
		const y = originY + particle.vy * time + 0.5 * gravity * time * time;
		const opacity = t < 0.05 ? t / 0.05 : t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.3) : 1;
		return {
			opacity,
			transform: [
				{ translateX: x - particle.size / 2 },
				{ translateY: y - particle.size / 2 },
				{ rotate: `${particle.spin * t}deg` },
				{ scaleY: particle.ring ? 0.45 : 1 },
			],
		};
	});
	return (
		<Animated.View
			style={[
				styles.atom,
				{
					width: particle.size * (particle.ring ? 1.9 : 1),
					height: particle.size * (particle.ring ? 1.9 : 1),
					borderRadius: particle.size,
					backgroundColor: particle.ring ? "transparent" : particle.color,
					borderColor: particle.color,
					borderWidth: particle.ring ? 2 : 0,
				},
				style,
			]}
		/>
	);
}

const styles = StyleSheet.create({
	atom: { position: "absolute", left: 0, top: 0 },
});
