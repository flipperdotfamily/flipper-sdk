# @flipperdotfamily/react-native: Expo example

A minimal Expo app. It shows `<FlipperWidget>` wired to **Reown AppKit** (WalletConnect), and a fully native flip UI
built on `useFlipperHeadless`.

This app has not been installed or run in the monorepo; the Expo toolchain wasn't installed there. The versions follow
Expo SDK 57's `bundledNativeModules.json`. Run `npx expo install --fix` after installing to line them up with your Expo
version.

```sh
cd packages/react-native/examples/react-native-expo
npm install            # or pnpm install --ignore-workspace
npx expo install --fix
cp .env.example .env   # set EXPO_PUBLIC_REOWN_PROJECT_ID (https://dashboard.reown.com) and your RPC
npx expo run:ios       # or run:android (a dev build: AppKit needs native modules)
```

## What to look at

- **`src/appkit.ts`:** `createAppKit` with Robinhood Chain (4663, viem's `robinhood` chain), the `EthersAdapter`,
  AsyncStorage-backed `storage`, and `redirect` metadata so the wallet returns to the app.
- **`App.tsx`:** the widget. The props are the AppKit `useProvider().provider` (EIP-1193), `useAccount()`'s address
  and chain, `open()` on `onConnectRequest`, a theme that follows the system, white-label options, and event
  handlers.
- **`src/HeadlessFlip.tsx`:** the same flip in native components through `useFlipperHeadless`.

## Local development

To point the widget at `pnpm dev:web` and the local fork (chain 31337), run with `EXPO_PUBLIC_FLIPPER_LOCAL=1`. iOS
Simulators use `http://localhost:3000/embed`; Android emulators use `http://10.0.2.2:3000/embed`. `app.json` enables
cleartext HTTP for that through `expo-build-properties`. Remove it, or scope it to a development profile, before
shipping.

`metro.config.js` watches the monorepo, so `@flipperdotfamily/react-native` and `@flipperdotfamily/sdk` resolve from their sources.
