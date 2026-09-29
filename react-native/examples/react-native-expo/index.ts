// Polyfills first: WalletConnect needs crypto.getRandomValues and a few Node globals.
import "@walletconnect/react-native-compat";
import "react-native-get-random-values";
import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
