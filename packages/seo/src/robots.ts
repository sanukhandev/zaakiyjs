import { normalizeCanonical } from "./url.js";
import type { CanonicalPolicy } from "./types.js";

export interface RobotsGroup {
  readonly agents: readonly string[];
  readonly allow?: readonly string[];
  readonly disallow?: readonly string[];
}
export interface RobotsTxtOptions extends CanonicalPolicy {
  readonly groups?: readonly RobotsGroup[];
  readonly sitemaps?: readonly string[];
}
function safeToken(value: string): string {
  if (!value.trim() || /[\r\n\x00-\x1f]/.test(value)) throw new TypeError("Invalid robots.txt token");
  return value;
}
export function generateRobotsTxt(options: RobotsTxtOptions): string {
  const lines: string[] = [];
  for (const group of options.groups ?? [{ agents: ["*"] }]) {
    if (!group.agents.length) throw new TypeError("robots.txt group needs a user-agent");
    for (const agent of group.agents) lines.push("User-agent: " + safeToken(agent));
    for (const route of group.allow ?? []) {
      if (!route.startsWith("/")) throw new TypeError("robots.txt paths must start with /");
      lines.push("Allow: " + safeToken(route));
    }
    for (const route of group.disallow ?? []) {
      if (!route.startsWith("/")) throw new TypeError("robots.txt paths must start with /");
      lines.push("Disallow: " + safeToken(route));
    }
    lines.push("");
  }
  for (const sitemap of options.sitemaps ?? []) lines.push("Sitemap: " + normalizeCanonical(sitemap, options));
  return lines.join("\n").trimEnd() + "\n";
}
