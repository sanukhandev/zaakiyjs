# @zaakiyjs/image

A local-first, compiler-compatible image optimization foundation for ZaakiyJS. It offers responsive width variants, WebP/AVIF, an accessible native picture, optional tiny blur data URLs, content-addressed assets, layout-stable dimensions and SSR HTML output.

**No Next.js, React, Vue, network request or mandatory image processing dependency is added to browser bundles.**

## Install

Install @zaakiyjs/image plus a supported image codec in the **build environment**. Version-pin Sharp and your lockfile independently. Image transformation runs in Node/CI, never on a client.

## Build responsive images (Node/Vite build step)

~~~ts
import sharp from "sharp";
import { createSharpProcessor, optimizeLocalImages } from "@zaakiyjs/image/node";

const { manifest, outputs } = await optimizeLocalImages({
  inputRoot: "./public/photos",
  outputDir: "./public/_zaakiy/images",
  publicPath: "/_zaakiy/images/",
  processor: createSharpProcessor(sharp, "sharp-0.35.5"),
  images: [{
    id: "hero",
    file: "hero.jpg",
    widths: [320, 640, 960, 1280],
    quality: 75,
    formats: ["webp", "avif"],
    placeholder: true
  }]
});
// Export manifest.images into a generated, trusted module or JSON asset at build time.
// Outputs are SHA-256-addressed image assets; no on-request transformation.
~~~

## Native browser rendering

~~~ts
import { createPicture, getImageProps } from "@zaakiyjs/image";
// image is manifest.images.hero loaded from a trusted generated image manifest
const picture = createPicture(document, image, {
  alt: "A descriptive photograph",
  sizes: "(max-width: 768px) 100vw, 50vw",
  priority: true
});
document.querySelector("#hero")?.append(picture);
const props = getImageProps(image, { alt: "A descriptive photograph" });
~~~

createPicture emits a real picture element with AVIF/WebP source sets and a JPEG/PNG fallback img. It is not a virtual DOM component. The image has explicit intrinsic width/height for aspect-ratio reservation, lazy loading by default, async decoding and high fetch priority when requested. The optional blurDataURL is provided as metadata, not injected into an inline HTML/style sink.

For SSR, import renderPictureHtml from the browser-safe root entry. Its attributes are HTML-escaped. Avoid injecting arbitrary HTML; only a trusted server template should insert the generated markup. The framework's restricted TSX compiler currently does not support object-spread props or a fully automatic Image component lowering.

## Safety boundaries

- **Local files only.** No remote URL, data URI, HTTP fetch or on-demand optimization endpoint; no SSRF or arbitrary request-driven dimensions.
- JPEG/PNG/WebP/AVIF raster sources only. SVG/GIF/animated/multipage inputs are rejected.
- Realpath traversal + symlink containment; max 20 MiB source, 40 megapixels, 256 image IDs, 8 widths per image and a maximum 20 MiB per generated variant.
- Quality 30–90. Never upscale. Encode each format and breakpoint ahead of time, with bounded sequential work.
- The manifest hash covers source-derived encoded artifact digests, width, format and processor ID; filenames include SHA-256 of output bytes. Existing content-addressed paths are verified before reuse. No timestamps in manifest identity.
- Source materials are trusted build inputs, not remote user uploads. The optional Sharp package must be installed, pinned and audited by the consuming build. Metadata/decode tests run against the installed processor.

## Benchmarks and limits

The E9 Image Optimization benchmark in CI generates a deterministic JPEG fixture and encodes the same widths and formats with pinned Sharp. It records source bytes, per-variant bytes, transfer savings and build p50/p95, verifying output dimensions, content hashes and exact replay.

This is a **build-time** optimizer. Unlike Next.js' general on-demand /_next/image endpoint, it processes a bounded local catalog at build time. No direct faster-than-Next.js claim is made; benchmark browser fetch/LCP/CLS and on-demand cache behavior separately before full feature parity.

## Public API

Root: OptimizedImage, ImageSource, ImageViewOptions, ImageProps, getImageProps, renderPictureHtml, createPicture.

Node: createSharpProcessor, optimizeLocalImages, ImageProcessor, LocalImageSource, BuildImageOptions, ImageManifest, ImageBuildResult and ImageOutputFile.
