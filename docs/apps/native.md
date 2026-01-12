# Native Application (`apps/native`)

The mobile application is built with **React Native** and **Expo**, utilizing **NativeWind** for styling.

## Technologies
- **React Native:** Framework for building native apps using React.
- **Expo:** Development platform and toolkit for React Native.
- **Expo Router:** File-based routing for React Native.
- **NativeWind:** Tailwind CSS for React Native.
- **tRPC Client:** For type-safe API communication.

## Directory Structure
- `app/`: Expo Router directory.
    - `_layout.tsx`: Root layout and providers.
    - `(drawer)/`: Navigation drawer.
    - `(tabs)/`: Bottom tab navigation.
- `components/`: Mobile-specific UI components.
- `utils/trpc.ts`: tRPC client configuration for mobile (pointing to the server URL).
- `lib/`: Shared utilities and hooks.
    - `auth-client.ts`: Better Auth client for React Native.
- `metro.config.js`: Metro bundler configuration.

## Key Commands
- `bun dev`: Starts the Expo development server.
- `bun ios`: Runs the app on an iOS simulator (macOS only).
- `bun android`: Runs the app on an Android emulator.
- `bun build:preview`: Creates a preview build via EAS.

## Development Tips
The native app communicates with the server via the same tRPC router as the web app. Ensure the server is running and the `BASE_URL` in `utils/trpc.ts` (or environment variables) is correctly set to your local IP address when testing on physical devices or emulators.
