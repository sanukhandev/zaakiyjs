/**
 * Browser-safe ZaakiyJS image descriptors.
 * Optimization is performed in Node/CI, never in the browser runtime.
 */
export interface ImageSource {
  readonly type: "image/avif" | "image/webp";
  readonly srcSet: string;
}
export interface OptimizedImage {
  readonly schema: "zaakiy.image/1";
  readonly width: number;
  readonly height: number;
  readonly src: string;
  readonly srcSet: string;
  readonly sources: readonly ImageSource[];
  /** Optional tiny encoded placeholder; never executed or loaded by this module. */
  readonly blurDataURL?: string;
}
export interface ImageViewOptions {
  /** Required. Use an empty string only for genuinely decorative images. */
  readonly alt: string;
  /** Responsive display slot sizing. Defaults to 100vw. */
  readonly sizes?: string;
  /** Prioritize an LCP/above-fold image; ordinary images remain lazy. */
  readonly priority?: boolean;
}
export interface ImageProps {
  readonly src: string;
  readonly srcSet: string;
  readonly sizes: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  readonly loading: "lazy" | "eager";
  readonly decoding: "async";
  readonly fetchPriority: "auto" | "high";
}
const PATH = /^\/[A-Za-z0-9_./-]+$/;
function safeAssetPath(value: string): boolean {
  return typeof value === "string" && value.length > 1 && value.length <= 512 &&
    PATH.test(value) && !value.startsWith("//") &&
    !value.split("/").some(part => part === "." || part === "..");
}
function checkSrcSet(srcSet: string): void {
  if (typeof srcSet !== "string" || srcSet.length === 0 || srcSet.length > 16_384 ||
      !srcSet.split(",").every(entry => {
        const m = /^(\S+) ([1-9]\d{0,4})w$/.exec(entry.trim());
        return Boolean(m && safeAssetPath(m[1]!));
      })) throw new TypeError("Invalid local responsive image srcSet");
}
function inspect(image: OptimizedImage, options: ImageViewOptions): string {
  if (!image || image.schema !== "zaakiy.image/1" ||
      !Number.isSafeInteger(image.width) || image.width < 1 || image.width > 16_384 ||
      !Number.isSafeInteger(image.height) || image.height < 1 || image.height > 16_384 ||
      !safeAssetPath(image.src) ||
      !Array.isArray(image.sources) || image.sources.length > 2 ||
      typeof options?.alt !== "string" || options.alt.length > 4096) {
    throw new TypeError("Invalid optimized image or missing accessible alt text");
  }
  checkSrcSet(image.srcSet);
  const types = new Set<string>();
  for (const source of image.sources) {
    if (!source || !["image/avif", "image/webp"].includes(source.type) ||
        types.has(source.type)) throw new TypeError("Invalid or duplicated picture source");
    types.add(source.type);
    checkSrcSet(source.srcSet);
  }
  const sizes = options.sizes ?? "100vw";
  if (typeof sizes !== "string" || !sizes || sizes.length > 1024 ||
      /[<>"']/.test(sizes) ||
      [...sizes].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new TypeError("Invalid responsive sizes");
  return sizes;
}
const escape = (text: string): string => text
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
/** Returns native image attributes for use in compiler-generated DOM bindings. */
export function getImageProps(image: OptimizedImage, options: ImageViewOptions): ImageProps {
  const sizes = inspect(image, options);
  return Object.freeze({
    src: image.src, srcSet: image.srcSet, sizes,
    width: image.width, height: image.height, alt: options.alt,
    loading: options.priority ? "eager" : "lazy",
    decoding: "async",
    fetchPriority: options.priority ? "high" : "auto"
  });
}
/** Escaped static HTML for trusted SSR/SSG templates, never an innerHTML sink. */
export function renderPictureHtml(image: OptimizedImage, options: ImageViewOptions): string {
  const p = getImageProps(image, options);
  const sources = image.sources.map(source =>
    '<source type="' + source.type + '" srcset="' + escape(source.srcSet) +
    '" sizes="' + escape(p.sizes) + '">').join("");
  return "<picture>" + sources + '<img src="' + escape(p.src) +
    '" srcset="' + escape(p.srcSet) + '" sizes="' + escape(p.sizes) +
    '" width="' + p.width + '" height="' + p.height + '" alt="' + escape(p.alt) +
    '" loading="' + p.loading + '" decoding="async" fetchpriority="' +
    p.fetchPriority + '"></picture>';
}
/** Pure native DOM element construction. This is not a React/Vue runtime. */
export function createPicture(
  document: Document, image: OptimizedImage, options: ImageViewOptions
): HTMLPictureElement {
  const p = getImageProps(image, options);
  const picture = document.createElement("picture");
  for (const source of image.sources) {
    const element = document.createElement("source");
    element.type = source.type;
    element.srcset = source.srcSet;
    element.sizes = p.sizes;
    picture.append(element);
  }
  const img = document.createElement("img");
  img.src = p.src;
  img.srcset = p.srcSet;
  img.sizes = p.sizes;
  img.width = p.width;
  img.height = p.height;
  img.alt = p.alt;
  img.loading = p.loading;
  img.decoding = "async";
  img.setAttribute("fetchpriority", p.fetchPriority);
  picture.append(img);
  return picture;
}
