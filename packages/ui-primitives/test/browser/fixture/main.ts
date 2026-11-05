import { createOwner, disposeOwner } from "@zaakiyjs/core";
import {
  createOverlayManager, createDialog, createTabs,
  createListbox, createMenu, createTooltip, createPopover, listen
} from "../../../src/index.ts";

const owner = createOwner();
const root = document.querySelector<HTMLElement>("#app")!;
const host = document.querySelector<HTMLElement>("#overlays")!;
const overlays = createOverlayManager({ owner, root, host });
const button = (id: string, label: string) => {
  const node = document.createElement("button");
  node.id = id;
  node.textContent = label;
  return node;
};
const div = (id: string, content = "") => {
  const node = document.createElement("div");
  node.id = id;
  node.textContent = content;
  return node;
};

const openDialog = button("open-dialog", "Open dialog");
const backdropFocus = button("background-focus", "Background");
root.append(openDialog, backdropFocus);
const dialog = document.createElement("section");
dialog.id = "dialog";
const heading = document.createElement("h2");
heading.id = "dialog-heading";
heading.textContent = "Account dialog";
const first = button("first", "First");
const openNested = button("open-nested", "Nested dialog");
const closeDialog = button("close-dialog", "Close dialog");
dialog.append(heading, first, openNested, closeDialog);
host.append(dialog);
const dialogController = createDialog({
  owner, element: dialog, overlays, labelledBy: heading.id
});
listen(openDialog, "click", () => dialogController.setOpen(true), owner);
listen(closeDialog, "click", () => dialogController.setOpen(false), owner);

const nested = document.createElement("section");
nested.id = "subdialog";
const nestedHeading = document.createElement("h3");
nestedHeading.id = "nested-heading";
nestedHeading.textContent = "Nested account dialog";
const nestedFirst = button("nested-first", "Nested first");
const nestedClose = button("nested-close", "Nested close");
nested.append(nestedHeading, nestedFirst, nestedClose);
host.append(nested);
const nestedController = createDialog({
  owner, element: nested, overlays, labelledBy: nestedHeading.id
});
listen(openNested, "click", () => nestedController.setOpen(true), owner);
listen(nestedClose, "click", () => nestedController.setOpen(false), owner);

const openNative = button("open-native", "Open native dialog");
root.append(openNative);
const nativeDialog = document.createElement("dialog");
nativeDialog.id = "native-dialog";
const nativeClose = button("native-close", "Close native dialog");
nativeDialog.append(nativeClose);
host.append(nativeDialog);
const nativeController = createDialog({
  owner, element: nativeDialog, overlays, ariaLabel: "Native account dialog", modal: true
});
listen(openNative, "click", () => nativeController.setOpen(true), owner);
listen(nativeClose, "click", () => nativeController.setOpen(false), owner);

const list = div("tabs");
const tabOne = button("tab-one", "Account"), tabTwo = button("tab-two", "Billing");
const panelOne = div("panel-one", "Account panel"), panelTwo = div("panel-two", "Billing panel");
list.append(tabOne, tabTwo);
root.append(list, panelOne, panelTwo);
const tabs = createTabs({ owner, list, defaultValue: "one", activation: "automatic" });
tabs.register({ id: "one", tab: tabOne, panel: panelOne });
tabs.register({ id: "two", tab: tabTwo, panel: panelTwo });

const listbox = div("listbox");
listbox.setAttribute("aria-label", "Available plans");
const optionOne = div("option-one", "Basic");
const optionTwo = div("option-two", "Premium");
listbox.append(optionOne, optionTwo);
root.append(listbox);
const select = createListbox({ owner, element: listbox });
select.register({ id: "basic", element: optionOne });
select.register({ id: "premium", element: optionTwo });

const openMenu = button("menu-trigger", "Actions");
const menuResult = div("menu-result", "none");
root.append(openMenu, menuResult);
const menuContent = div("menu-content");
const menuA = button("menu-a", "Alpha"), menuB = button("menu-b", "Beta");
menuContent.append(menuA, menuB);
host.append(menuContent);
const menu = createMenu({ owner, trigger: openMenu, content: menuContent, overlays });
menu.register({ id: "a", element: menuA, onSelect() { menuResult.textContent = "alpha"; } });
menu.register({ id: "b", element: menuB, onSelect() { menuResult.textContent = "beta"; } });

const tipTrigger = button("tip-trigger", "Help");
const tip = div("tooltip", "Contextual help");
root.append(tipTrigger, tip);
createTooltip({ owner, trigger: tipTrigger, tooltip: tip, delayMs: 25 });

const popTrigger = button("popover-trigger", "Open settings");
const popContent = div("popover-content", "Settings content");
const popLink = button("popover-action", "Apply");
popContent.append(popLink);
root.append(popTrigger);
host.append(popContent);
createPopover({ owner, trigger: popTrigger, content: popContent, overlays, autoFocus: true });

declare global { interface Window { zaakiyP2FixtureDispose?: () => void } }
window.zaakiyP2FixtureDispose = () => {
  disposeOwner(owner);
  delete window.zaakiyP2FixtureDispose;
};
