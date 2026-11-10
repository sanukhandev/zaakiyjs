import { createHash } from "node:crypto";
import type { TrustedModuleRegistration, TrustedServerBuildManifestV1 } from "./protocol.js";

const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/;
const ROUTE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/;
const moduleIdSafe = (id: string): boolean => ID.test(id) &&
  id.split("/").every(part => part !== "" && part !== "." && part !== "..");

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
    if (!ROUTE_ID.test(routeId) || entry.routeId !== routeId ||
        !moduleIdSafe(entry.moduleId) || !DIGEST.test(entry.sourceDigest)) {
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


/**
 * A build-controlled, immutable snapshot of one emitted server module's exact
 * bytes. This is NOT TSX compilation and does not execute or import a module.
 */
export interface ServerBuildArtifactV1 {
  readonly routeId: string;
  readonly moduleId: string;
  readonly bytes: Uint8Array;
}
const MAX_ARTIFACTS = 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const hashBytes = (value: Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

function verifiedBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength < 1 ||
      value.byteLength > MAX_ARTIFACT_BYTES) {
    throw new TypeError("Expected non-empty bounded emitted server module bytes");
  }
  // Snapshot source bytes: caller mutation after the check cannot change
  // this hash or accidentally alias a re-used memory buffer.
  return new Uint8Array(value);
}

/**
 * Generate a byte-derived, deterministic manifest. Route entries are sorted
 * before buildId hashing. The sourceDigest field is the SHA-256 of the emitted
 * module bytes, NOT a claim supplied by a module registration.
 */
export function buildVerifiedManifestV1(
  artifacts: readonly ServerBuildArtifactV1[]
): TrustedServerBuildManifestV1 {
  if (!Array.isArray(artifacts) || !artifacts.length ||
      artifacts.length > MAX_ARTIFACTS) {
    throw new TypeError("Invalid server artifact count");
  }
  const routes: Record<string, { moduleId: string; sourceDigest: string; routeId: string }> =
    Object.create(null) as Record<string, { moduleId: string; sourceDigest: string; routeId: string }>;
  const moduleHashes = new Map<string, string>();
  for (const item of artifacts) {
    if (!item || !ROUTE_ID.test(item.routeId) || !moduleIdSafe(item.moduleId) ||
        Object.hasOwn(routes, item.routeId)) {
      throw new TypeError("Duplicate or invalid build route/module identity");
    }
    const digest = hashBytes(verifiedBytes(item.bytes));
    const previous = moduleHashes.get(item.moduleId);
    if (previous && previous !== digest) {
      throw new TypeError("One server module ID cannot reference different module bytes");
    }
    moduleHashes.set(item.moduleId, digest);
    routes[item.routeId] = {
      moduleId: item.moduleId, sourceDigest: digest, routeId: item.routeId
    };
  }
  const canonical = Object.keys(routes).sort().map(routeId => {
    const item = routes[routeId]!;
    return [item.routeId, item.moduleId, item.sourceDigest];
  });
  const buildId = createHash("sha256")
    .update(JSON.stringify(["zaakiy.render-manifest/1", 1, 1, canonical]))
    .digest("hex");
  return {
    schema: "zaakiy.render-manifest/1", buildId,
    irVersion: 1, domAbiVersion: 1, routes
  };
}

/**
 * Deployment/build gate: verify the exact pinned server module bytes against
 * every declared digest AND the canonical buildId. Does not prove that the
 * host's module loader later imports those same bytes; that requires a
 * deployment-controlled loader and registry binding.
 */
export function verifyTrustedArtifactBytes(
  manifest: TrustedServerBuildManifestV1,
  artifactsByModuleId: Readonly<Record<string, Uint8Array>>
): void {
  if (!manifest || manifest.schema !== "zaakiy.render-manifest/1" ||
      manifest.irVersion !== 1 || manifest.domAbiVersion !== 1 ||
      !DIGEST.test(manifest.buildId) ||
      !manifest.routes || typeof manifest.routes !== "object" ||
      Array.isArray(manifest.routes) ||
      !artifactsByModuleId || typeof artifactsByModuleId !== "object") {
    throw new TypeError("Invalid trusted server artifact manifest");
  }
  const entries: ServerBuildArtifactV1[] = [];
  const expectedModules = new Set<string>();
  for (const [routeId, entry] of Object.entries(manifest.routes)) {
    if (!entry || entry.routeId !== routeId ||
        !ROUTE_ID.test(routeId) || !moduleIdSafe(entry.moduleId) ||
        !DIGEST.test(entry.sourceDigest)) {
      throw new TypeError("Invalid trusted artifact identity/digest");
    }
    const descriptor = Object.getOwnPropertyDescriptor(artifactsByModuleId, entry.moduleId);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("Missing trusted artifact bytes: " + entry.moduleId);
    }
    entries.push({ routeId, moduleId: entry.moduleId, bytes: verifiedBytes(descriptor.value) });
    expectedModules.add(entry.moduleId);
  }
  if (!entries.length || Object.keys(artifactsByModuleId).length !== expectedModules.size) {
    throw new TypeError("Unexpected or missing build artifacts");
  }
  const generated = buildVerifiedManifestV1(entries);
  if (generated.buildId !== manifest.buildId ||
      entries.some(entry =>
        generated.routes[entry.routeId]!.sourceDigest !==
        manifest.routes[entry.routeId]!.sourceDigest)) {
    throw new TypeError("Server module bytes do not match trusted build manifest");
  }
}
