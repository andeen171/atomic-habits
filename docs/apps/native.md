# Mobile (`apps/native`)

Expo SDK 57 (React Native 0.86, new architecture) with Expo Router. Styling is `StyleSheet` plus a
theme context built from `@atomic/core/theme` — no CSS-in-JS runtime.

## Structure
- `app/(tabs)/` — Today, Habits, Tasks, You, with a custom tab bar and a center create button.
- `app/habit/[id].tsx`, `app/habit/editor.tsx`, `app/task/[id].tsx` (sheet), `identity`,
  `insights`, `scorecard`, `settings`, `onboarding`.
- `components/` — `habit/` (animated ring, row, actions sheet, calendar), `today/`, `charts/`,
  `sheet/` (reanimated + gesture-handler bottom sheet rendered through a portal), `ui/`.
- `lib/` — `store.ts` (expo-sqlite kv-store), `sync.ts` (SecureStore session), `reminders.ts`
  (expo-notifications), `backup.ts` (share sheet / document picker), `theme.tsx`, `haptics.ts`,
  `messages.ts`. `*.web.ts` variants keep the web export working.

## Commands
| Command | |
| --- | --- |
| `bun dev` | Expo dev server (dev client or simulator) |
| `bun android` / `bun ios` | Local native build (`expo run:*`) |
| `bun run export` | Bundle check (`expo export --platform android`) |
| `bun check-types` | TypeScript |

## Builds
- GitHub Actions (`.github/workflows/android.yml`) prebuilds and assembles a standalone release APK
  and a dev-client debug APK on every relevant push.
- `eas.json` has `development`, `preview` and `production` profiles for EAS Build; the EAS project
  is `@andeen/atomic-habits`.
