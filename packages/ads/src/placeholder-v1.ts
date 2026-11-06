import type { AdSlotV1 } from "./contract-v1.js";

const SLOT_ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
}
function dimension(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 4096;
}
/** Privacy-neutral, stable SSR slot geometry. Does not load vendor scripts. */
export function renderAdSlotPlaceholderV1(slot: AdSlotV1, label = "Advertisement"): string {
  if (slot.schema !== "zaakiy.ads/1" || !SLOT_ID.test(slot.id) ||
      !dimension(slot.reserve.minWidth) || !dimension(slot.reserve.minHeight) ||
      (slot.reserve.aspectRatio !== undefined &&
        (!Number.isFinite(slot.reserve.aspectRatio) || slot.reserve.aspectRatio <= 0 || slot.reserve.aspectRatio > 20)) ||
      label.length > 160) throw new TypeError("Invalid SSR ad slot placeholder");
  const style = "min-width:" + slot.reserve.minWidth + "px;min-height:" +
    slot.reserve.minHeight + "px;" +
    (slot.reserve.aspectRatio === undefined ? "" : "aspect-ratio:" + slot.reserve.aspectRatio + ";") +
    "contain:layout style;";
  return '<div data-zaakiy-ad-slot="' + escape(slot.id) +
    '" role="complementary" aria-label="' + escape(label) +
    '" style="' + style + '"></div>';
}
