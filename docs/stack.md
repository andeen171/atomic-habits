# Technology stack

| Layer | Choice |
| --- | --- |
| Language | TypeScript 5.9 (strict), Zod 4 for runtime validation |
| Package manager / runtime | Bun 1.4 (hoisted linker), Turborepo |
| Shared state | zustand 5 (vanilla store + React bindings in `@atomic/core/react`) |
| Web | React 19.2, Vite 7, TanStack Router (file routes, hash/memory history), Tailwind CSS v4, Radix primitives, cmdk, sonner, motion, lucide-react, canvas-confetti |
| Desktop | Tauri 2 wrapping the web build |
| Mobile | Expo SDK 57 (React Native 0.86, new architecture), Expo Router, Reanimated 4, Gesture Handler, react-native-svg, expo-notifications, expo-sqlite, expo-secure-store, lucide-react-native |
| Fonts | Geist (UI) and Instrument Serif (display) via Fontsource / @expo-google-fonts |
| Server | Hono, tRPC 11 (plain HTTP), Better Auth (email + bearer), Drizzle ORM on libSQL / Turso |
| Docs | Astro Starlight |
| Quality | Biome, `bun test`, Playwright for visual QA, GitHub Actions |
