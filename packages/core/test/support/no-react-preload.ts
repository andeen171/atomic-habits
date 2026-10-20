import { plugin } from "bun";

/**
 * Preload for `core-imports.test.ts`: makes loading any React package throw,
 * so a subprocess proves which entry points stay React-free at runtime.
 */
plugin({
	name: "no-react",
	setup(build) {
		build.onLoad(
			{
				filter: /[\\/]node_modules[\\/](react|react-dom|react-native|use-sync-external-store)[\\/]/,
			},
			(args) => {
				throw new Error(`react loaded: ${args.path}`);
			},
		);
	},
});
