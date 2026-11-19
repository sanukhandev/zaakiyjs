// @vitest-environment jsdom
import {afterEach, describe, expect, it} from "vitest";
import {createOwner, disposeOwner, runWithOwner} from "@zaakiyjs/core";
import {createOwnedNativeSlot} from "@zaakiyjs/dom/compiler";
import {createOverlayManager} from "@zaakiyjs/ui-primitives";
import {Dialog, Popover} from "../src/index.js";

afterEach(() => { document.body.replaceChildren(); });

describe("compiled interactive native slots", () => {
  it("inserts real native Dialog and Popover content with stable caller ownership", () => {
    const owner = createOwner();
    const host = document.createElement("section");
    document.body.appendChild(host);
    const overlays = createOverlayManager({root: host, host, owner});
    const dialogSlot = createOwnedNativeSlot(owner, () => {
      const content = document.createElement("p");
      content.textContent = "<b>Saved</b>";
      content.setAttribute("data-slot", "dialog");
      return content;
    });
    const popoverSlot = createOwnedNativeSlot(owner, () => {
      const content = document.createElement("button");
      content.type = "button";
      content.textContent = "Open options";
      content.setAttribute("data-slot", "popover");
      return content;
    });
    const dialog = runWithOwner(owner, () => Dialog({
      id: "save-dialog", title: "Save", description: "Your changes",
      triggerLabel: "Save", overlays, body: dialogSlot
    })) as unknown as HTMLElement;
    const popover = runWithOwner(owner, () => Popover({
      id: "profile-popover", triggerLabel: "Profile", overlays, content: popoverSlot
    })) as unknown as HTMLElement;
    host.append(dialog, popover);
    const dialogContent = dialog.querySelector('[data-slot="dialog"]');
    const popoverContent = popover.querySelector('[data-slot="popover"]');
    expect(dialogContent?.textContent).toBe("<b>Saved</b>");
    expect(dialogContent?.querySelector("b")).toBeNull();
    expect(popoverContent?.textContent).toBe("Open options");
    expect(dialog.querySelector("#save-dialog-title")?.textContent).toBe("Save");
    expect(dialog.querySelector('button:last-child')?.textContent).toBe("Close");
    expect(dialogSlot.mounted).toBe(true);
    expect(popoverSlot.mounted).toBe(true);
    expect(popover.querySelector('[data-slot="popover"]')).toBe(popoverContent);
    expect(() => runWithOwner(owner, () => Popover({
      id: "duplicate", triggerLabel: "Duplicate", overlays, content: popoverSlot
    }))).toThrow();
    disposeOwner(owner);
    expect(dialogSlot.disposed).toBe(true);
    expect(popoverSlot.disposed).toBe(true);
    expect(dialog.querySelector('[data-slot="dialog"]')).toBeNull();
    expect(popover.querySelector('[data-slot="popover"]')).toBeNull();
  });

  it("rejects forged HTML/string slots and missing Popover content", () => {
    const owner = createOwner();
    const host = document.createElement("section");
    document.body.appendChild(host);
    const overlays = createOverlayManager({root: host, host, owner});
    expect(() => runWithOwner(owner, () => Dialog({
      id: "unsafe", title: "Unsafe", description: "Check",
      triggerLabel: "Show", overlays, body: "<script>alert(1)</script>"
    }))).toThrow("Only an owned native slot");
    expect(() => runWithOwner(owner, () => Popover({
      id: "empty", triggerLabel: "Show", overlays
    }))).toThrow("Popover requires text or a compiled content slot");
    expect(() => runWithOwner(owner, () => Popover({
      id: "unsafe", triggerLabel: "Show", overlays, content: "<img src=x>"
    }))).toThrow("Only an owned native slot");
    disposeOwner(owner);
  });
});
