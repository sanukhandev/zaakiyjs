import { describe, expect, it } from "vitest";
import { buildVerifiedManifestV1, verifyTrustedArtifactBytes, verifyTrustedManifest } from "../src/build.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const source = bytes("export const handler = () => '<main>compiled</main>';");
const alternate = bytes("export const handler = () => '<main>second</main>';");

describe("byte-attested SSR build manifest", () => {
  it("derives stable build IDs from actual emitted module bytes independent of route ordering", () => {
    const entries = [
      { routeId: "product", moduleId: "compiled/product", bytes: source },
      { routeId: "category", moduleId: "compiled/category", bytes: alternate }
    ];
    const one = buildVerifiedManifestV1(entries);
    const two = buildVerifiedManifestV1([...entries].reverse());
    expect(one).toEqual(two);
    expect(one.buildId).toMatch(/^[a-f0-9]{64}$/);
    expect(one.routes.product?.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(one.routes.product?.sourceDigest).not.toBe(one.routes.category?.sourceDigest);
    const artifacts = {
      "compiled/product": source,
      "compiled/category": alternate
    };
    expect(() => verifyTrustedArtifactBytes(one, artifacts)).not.toThrow();
  });

  it("rejects edited, omitted, extra or getter-backed server artifacts", () => {
    const manifest = buildVerifiedManifestV1([
      { routeId: "product", moduleId: "compiled/product", bytes: source }
    ]);
    expect(() => verifyTrustedArtifactBytes(manifest, {
      "compiled/product": bytes("tampered")
    })).toThrow(/bytes do not match/);
    expect(() => verifyTrustedArtifactBytes(manifest, {})).toThrow(/Missing trusted/);
    expect(() => verifyTrustedArtifactBytes(manifest, {
      "compiled/product": source, "compiled/unknown": source
    })).toThrow(/Unexpected or missing/);
    const untrusted = Object.defineProperty({}, "compiled/product", {
      enumerable: true,
      get() { throw new Error("getter must not execute"); }
    }) as Record<string, Uint8Array>;
    expect(() => verifyTrustedArtifactBytes(manifest, untrusted)).toThrow(/Missing trusted/);
  });

  it("rejects tampered build identities even if per-route digests match", () => {
    const manifest = buildVerifiedManifestV1([
      { routeId: "product", moduleId: "compiled/product", bytes: source }
    ]);
    expect(() => verifyTrustedArtifactBytes({
      ...manifest, buildId: "0".repeat(64)
    }, { "compiled/product": source })).toThrow(/bytes do not match/);
    expect(() => verifyTrustedArtifactBytes({
      ...manifest, routes: {
        product: { ...manifest.routes.product!, sourceDigest: "a".repeat(64) }
      }
    }, { "compiled/product": source })).toThrow(/bytes do not match/);
  });

  it("rejects ambiguous, malformed and oversized manifests without executing source", () => {
    const entry = { routeId: "product", moduleId: "compiled/product", bytes: source };
    expect(() => buildVerifiedManifestV1([entry, entry])).toThrow(/Duplicate/);
    expect(() => buildVerifiedManifestV1([
      { ...entry, routeId: "../secrets" }
    ])).toThrow(/Duplicate or invalid/);
    expect(() => buildVerifiedManifestV1([
      { ...entry, bytes: new Uint8Array() }
    ])).toThrow(/bounded/);
    expect(() => buildVerifiedManifestV1([])).toThrow(/count/);
  });

  it("keeps the established runtime registry gate as a separate requirement", () => {
    const manifest = buildVerifiedManifestV1([
      { routeId: "product", moduleId: "compiled/product", bytes: source }
    ]);
    expect(() => verifyTrustedManifest(manifest, {
      "compiled/product": {
        sourceDigest: manifest.routes.product!.sourceDigest,
        module: { protocol: "zaakiy.render/1", render: () => ({
          version: 1, status: 200, headers: {}, body: "<p>ok</p>",
          cache: { scope: "no-store", tags: [] }
        }) }
      }
    })).not.toThrow();
    // The registry gate alone cannot prove loaded bytes. Production build and
    // loader code must separately call verifyTrustedArtifactBytes.
  });
});
