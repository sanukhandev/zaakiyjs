import { mount } from "@zaakiyjs/dom";
import { App, fixture } from "./App";
import "virtual:zaakiy-styles.css";
import "./base.css";

const target = document.getElementById("app");
if (!target) throw new Error("Missing #app mount target");
const handle = mount(() => <App />, target);

// Test-only diagnostics, never part of any published ZaakiyJS runtime API.
const testWindow = window as unknown as {
  __zaakiyAcceptance?: {
    dispose: () => void;
    isDisposed: () => boolean;
    lifecycle: typeof fixture.lifecycle;
    getSelected: () => string;
    getCounter: () => number;
    mutateDisposedSignals: () => void;
  };
};
testWindow.__zaakiyAcceptance = {
  dispose: () => handle.dispose(),
  isDisposed: () => handle.owner.disposed,
  lifecycle: fixture.lifecycle,
  getSelected: () => fixture.selected.value,
  getCounter: () => fixture.counter.value,
  mutateDisposedSignals: () => {
    fixture.counter.value++;
    fixture.visible.value = !fixture.visible.value;
    fixture.rows.value = [];
  }
};
