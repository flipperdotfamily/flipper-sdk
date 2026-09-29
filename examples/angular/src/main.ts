import { provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app/app.component";
import { loadStack } from "./app/showcase";
import { STACK } from "./app/stack";

// the stack first (chain, contracts and, on a local fork, the dev wallet), then the app
loadStack()
  .then((stack) => bootstrapApplication(AppComponent, { providers: [provideZonelessChangeDetection(), { provide: STACK, useValue: stack }] }))
  .catch((err) => console.error(err));
