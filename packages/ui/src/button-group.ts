import type { ViewNode } from "@zaakiyjs/core";
import { currentOwner, native, view, nonEmpty } from "./native.js";
import { Button } from "./components.js";
import type { ButtonProps } from "./components.js";

export interface ButtonGroupProps {
  readonly label: string;
  readonly buttons: readonly ButtonProps[];
  readonly orientation?: "horizontal" | "vertical";
}
/** Accessible group of native buttons; no implicit shared selection state. */
export function ButtonGroup(props: ButtonGroupProps): ViewNode {
  currentOwner();
  const group = native("div");
  group.className = "zui-button-group";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", nonEmpty(props.label, "ButtonGroup label"));
  if (props.orientation === "vertical") group.classList.add("zui-button-group--vertical");
  for (const button of props.buttons) {
    group.appendChild(Button(button) as unknown as Node);
  }
  return view(group);
}
