import type { AdSlotConfig } from "./types.js";

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
}
export function renderAdSlotPlaceholder(config: Pick<AdSlotConfig, "id" | "minHeight" | "label">): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(config.id)) throw new TypeError("Invalid ad slot ID");
  if (!Number.isSafeInteger(config.minHeight) || config.minHeight < 1 || config.minHeight > 4096) throw new RangeError("Invalid reserved height");
  const label = escapeAttribute(config.label ?? "Advertisement");
  return '<div data-zaakiy-ad-slot="' + escapeAttribute(config.id) +
    '" role="complementary" aria-label="' + label +
    '" style="min-height:' + config.minHeight + 'px;contain:layout style;"></div>';
}
