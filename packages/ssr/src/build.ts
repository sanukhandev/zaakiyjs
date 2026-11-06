import type { TrustedModuleRegistration, TrustedServerBuildManifestV1 } from "./protocol.js";

const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/;

/** Validate a pinned manifest and a deployment-controlled immutable registry. No dynamic imports. */
export function verifyTrustedManifest(
  manifest: TrustedServerBuildManifestV1,
  registry: Readonly<Record<string, TrustedModuleRegistration>>
): void {
  if (manifest.schema !== "zaakiy.render-manifest/1" || manifest.irVersion !== 1 ||
      manifest.domAbiVersion !== 1 || !DIGEST.test(manifest.buildId)) {
    throw new TypeError("SSR manifest schema, build ID or ABI mismatch");
  }
  for (const [routeId, entry] of Object.entries(manifest.routes)) {
    if (!ID.test(routeId) || entry.routeId !== routeId ||
        !ID.test(entry.moduleId) || !DIGEST.test(entry.sourceDigest)) {
      throw new TypeError("Invalid trusted render manifest entry");
    }
    const registration = Object.getOwnPropertyDescriptor(registry, entry.moduleId);
    if (!registration || !("value" in registration) || !registration.value ||
        registration.value.sourceDigest !== entry.sourceDigest ||
        registration.value.module?.protocol !== "zaakiy.render/1" ||
        typeof registration.value.module.render !== "function") {
      throw new TypeError("Missing or incompatible trusted server module: " + routeId);
    }
  }
}
