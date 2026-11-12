import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getImageProps, renderPictureHtml } from "../src/index.js";
import { optimizeLocalImages, createSharpProcessor } from "../src/node.js";
import type { ImageProcessor } from "../src/node.js";

const encoder = new TextEncoder();
const processor: ImageProcessor = {
  id: "test-pinned-codec-1",
  metadata: async () => ({ width: 1200, height: 800, format: "jpeg", pages: 1 }),
  encode: async (_source, { width, format, quality }) =>
    encoder.encode("signed-test-output:" + width + ":" + format + ":" + quality)
};
async function directory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "zaakiy-image-"));
}
async function withFixture(test: (root: string) => Promise<void>): Promise<void> {
  const root = await directory();
  try {
    await mkdir(join(root, "input"));
    await writeFile(join(root, "input", "photo.jpg"), "synthetic-decoder-test-only");
    await test(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const config = (root: string) => ({
  inputRoot: join(root, "input"),
  outputDir: join(root, "optimized"),
  images: [{ id: "hero", file: "photo.jpg", widths: [320, 640, 1200], placeholder: true }],
  processor
});
describe("@zaakiyjs/image offline build optimizer", () => {
  it("emits deterministic content-addressed variants and a stable manifest", async () => {
    await withFixture(async root => {
      const a = await optimizeLocalImages(config(root));
      const b = await optimizeLocalImages(config(root));
      expect(b.manifest).toEqual(a.manifest);
      expect(a.manifest.buildId).toMatch(/^[0-9a-f]{64}$/);
      expect(a.outputs).toHaveLength(9);
      expect(a.outputs.every(item => item.bytes > 0 &&
        item.sha256.length === 64)).toBe(true);
      expect(a.manifest.images.hero?.width).toBe(1200);
      expect(a.manifest.images.hero?.height).toBe(800);
      expect(a.manifest.images.hero?.sources.map(x => x.type)).toEqual(["image/avif", "image/webp"]);
      expect(a.manifest.images.hero?.srcSet).toContain("320w");
      expect(a.manifest.images.hero?.blurDataURL).toMatch(/^data:image\/webp;base64,/);
      expect(await readFile(join(root, "optimized", a.outputs[0]!.file))).toHaveLength(a.outputs[0]!.bytes);
      expect(a.originalBytes).toBeGreaterThan(0);
    });
  });

  it("rejects remote URLs, traversal, escape symlinks and unsupported image formats", async () => {
    await withFixture(async root => {
      const make = (file: string) => optimizeLocalImages({
        ...config(root), images: [{ id: "photo", file }]
      });
      await expect(make("https://example.test/photo.jpg")).rejects.toThrow(/local file/);
      await expect(make("../outside.jpg")).rejects.toThrow(/local file/);
      await expect(make("/etc/passwd")).rejects.toThrow(/local file/);
      await expect(make("photo.svg")).rejects.toThrow(/JPEG\/PNG/);
      await expect(make("photo.jpg?size=20")).rejects.toThrow(/JPEG\/PNG/);
      const outside = join(root, "outside.jpg");
      await writeFile(outside, "not permitted");
      await symlink(outside, join(root, "input", "alias.jpg"));
      await expect(make("alias.jpg")).rejects.toThrow(/symlink/);
    });
  });

  it("fails closed on unsafe dimensions, duplicate IDs, invalid quality and deceptive decoders", async () => {
    await withFixture(async root => {
      await expect(optimizeLocalImages({
        ...config(root), images: [
          { id: "hero", file: "photo.jpg" }, { id: "hero", file: "photo.jpg" }
        ]
      })).rejects.toThrow(/Duplicate/);
      await expect(optimizeLocalImages({
        ...config(root), images: [{ id: "hero", file: "photo.jpg", widths: [0, 32] }]
      })).rejects.toThrow(/widths/);
      await expect(optimizeLocalImages({
        ...config(root), images: [{ id: "hero", file: "photo.jpg", quality: 99 }]
      })).rejects.toThrow(/quality/);
      await expect(optimizeLocalImages({
        ...config(root), processor: { ...processor,
          metadata: async () => ({ width: 2000, height: 1200, format: "svg" })
        }
      })).rejects.toThrow(/metadata/);
      await expect(optimizeLocalImages({
        ...config(root), processor: { ...processor,
          metadata: async () => ({ width: 12000, height: 12000, format: "jpeg" })
        }
      })).rejects.toThrow(/pixel/);
    });
  });

  it("requires a pinned Sharp processor without importing Sharp in browser entrypoints", () => {
    expect(() => createSharpProcessor(null as never, "sharp-v1")).toThrow(/pinned/);
    expect(() => createSharpProcessor(() => ({} as never), "../untrusted")).toThrow(/pinned/);
  });

  it("reserves layout and escapes accessible SSR picture markup", async () => {
    await withFixture(async root => {
      const image = (await optimizeLocalImages(config(root))).manifest.images.hero!;
      const p = getImageProps(image, { alt: "A photograph", priority: true, sizes: "(max-width: 600px) 100vw, 50vw" });
      expect(p).toMatchObject({
        width: 1200, height: 800, loading: "eager", fetchPriority: "high"
      });
      expect(getImageProps(image, { alt: "" }).loading).toBe("lazy");
      const html = renderPictureHtml(image, { alt: 'x"><script>alert(1)</script>' });
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<script>");
      expect(html).toContain('loading="lazy"');
      expect(html).toContain('width="1200" height="800"');
      expect(html).toContain("image/avif");
      expect(() => getImageProps(image, { alt: "ok", sizes: '"><img src=x>' })).toThrow(/sizes/);
      expect(() => getImageProps({ ...image, src: "javascript:alert(1)" }, { alt: "ok" })).toThrow(/Invalid/);
      expect(() => getImageProps(image, { alt: 42 as never })).toThrow(/Invalid/);
    });
  });
});