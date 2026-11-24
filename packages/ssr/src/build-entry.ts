/** Build-only exports. Does not import the browser DOM or runtime compiler. */
export { verifyTrustedManifest, buildVerifiedManifestV1, verifyTrustedArtifactBytes } from "./build.js";
export type { ServerBuildArtifactV1 } from "./build.js";
export { prerenderStatic } from "./ssg.js";
export type { StaticBuildOptions, StaticResult } from "./ssg.js";
