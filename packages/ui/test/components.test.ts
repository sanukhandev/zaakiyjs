// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createOwner, disposeOwner, runWithOwner } from "@zaakiyjs/core";
import { signal, flushSync } from "@zaakiyjs/signals";
import { Alert, Badge, Button, Checkbox, Progress, Table, TextField } from "../src/index.js";

describe("owner-scoped native UI", () => {
  it("guards disabled/loading actions and releases event listeners on disposal", () => {
    const scope = createOwner();
    let fired = 0;
    const button = runWithOwner(scope, () => Button({ label: "Save", onPress: () => { fired++; } })) as unknown as HTMLButtonElement;
    const disabled = runWithOwner(scope, () => Button({ label: "Save", disabled: true, onPress: () => { fired++; } })) as unknown as HTMLButtonElement;
    const loading = runWithOwner(scope, () => Button({ label: "Save", loading: true, onPress: () => { fired++; } })) as unknown as HTMLButtonElement;
    document.body.append(button, disabled, loading);
    disabled.click();
    loading.click();
    expect(fired).toBe(0);
    expect(loading.getAttribute("aria-busy")).toBe("true");
    button.click();
    expect(fired).toBe(1);
    disposeOwner(scope);
    button.click();
    expect(fired).toBe(1);
    document.body.replaceChildren();
  });

  it("keeps input identity and supports signal-backed changes", () => {
    const scope = createOwner();
    const value = signal("start");
    const field = runWithOwner(scope, () => TextField({ id: "title", label: "Title", value, required: true })) as unknown as HTMLElement;
    const input = field.querySelector("input");
    expect(input?.value).toBe("start");
    expect(field.querySelector('label[for="title"]')?.textContent).toBe("Title");
    expect(input?.required).toBe(true);
    document.body.append(field);
    if (!input) throw new Error("missing input");
    input.value = "updated";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(value.value).toBe("updated");
    flushSync();
    expect(field.querySelector("input")).toBe(input);
    disposeOwner(scope);
    document.body.replaceChildren();
  });

  it("updates a native checkbox signal and keeps semantics", () => {
    const scope = createOwner();
    const value = signal(false);
    const label = runWithOwner(scope, () => Checkbox({ label: "Accept", checked: value })) as unknown as HTMLLabelElement;
    const input = label.querySelector("input");
    expect(input?.type).toBe("checkbox");
    if (!input) throw new Error("missing checkbox");
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(value.value).toBe(true);
    disposeOwner(scope);
  });

  it("escapes text, uses native semantics, and rejects malformed data", () => {
    const scope = createOwner();
    const message = "<img src=x onerror=alert(1)>";
    const alert = runWithOwner(scope, () => Alert({ message, tone: "danger" })) as unknown as HTMLElement;
    const badge = runWithOwner(scope, () => Badge({ label: message })) as unknown as HTMLElement;
    const progress = runWithOwner(scope, () => Progress({ label: "Loading", value: 3, max: 10 })) as unknown as HTMLProgressElement;
    const table = runWithOwner(scope, () => Table({ caption: "Items", headers: ["A"], rows: [[message]] })) as unknown as HTMLTableElement;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.querySelector("img")).toBeNull();
    expect(badge.textContent).toBe(message);
    expect(progress.value).toBe(3);
    expect(table.querySelector("th")?.scope).toBe("col");
    expect(table.querySelector("td")?.textContent).toBe(message);
    expect(() => runWithOwner(scope, () => Progress({ label: "Bad", value: 99, max: 10 }))).toThrow(RangeError);
    disposeOwner(scope);
  });
});
