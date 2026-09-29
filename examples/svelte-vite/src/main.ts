import { mount } from "svelte";
import App from "./App.svelte";
import { loadStack } from "./showcase";
import { createWallet } from "./wallet.svelte";
import "./styles.css";

const stack = await loadStack();
mount(App, { target: document.getElementById("app")!, props: { stack, wallet: createWallet(stack) } });
