import type { TemplateId, TemplateManifest, TemplateOptionSpec } from "./types.js";
import type {TemplateCapability} from "./contracts.js";
import {templateAssetChecksums} from "./asset-checksums.js";
const options: readonly TemplateOptionSpec[] = Object.freeze([
  Object.freeze({name:"brandName",type:"string",required:false}),
  Object.freeze({name:"primaryColor",type:"color",required:false}),
  Object.freeze({name:"appearance",type:"enum",required:false,values:Object.freeze(["system","light","dark"])}),
  Object.freeze({name:"radius",type:"enum",required:false,values:Object.freeze(["sm","md","lg"])})
]);
const common = [
  "README.md","package.json","index.html","tsconfig.json","vite.config.ts",
  "zaakiy.config.ts","src/main.tsx","src/App.tsx","src/base.css"
] as const;
const feature = (name: string, entity: string): readonly string[] => [
  `src/features/${name}/models/${entity}.ts`,
  `src/features/${name}/services/${entity}Repository.ts`,
  `src/features/${name}/viewmodels/create${entity[0]?.toUpperCase() ?? ""}${entity.slice(1)}ViewModel.ts`,
  `src/features/${name}/views/${entity[0]?.toUpperCase() ?? ""}${entity.slice(1)}View.tsx`,
  `src/features/${name}/adapters/create${entity[0]?.toUpperCase() ?? ""}${entity.slice(1)}Page.ts`
];
const define = (id: TemplateId, category: TemplateManifest["category"], name: string,
  description: string, packages: readonly string[], features: readonly string[],
  featurePath: string, entity: string, limitations: readonly string[]): TemplateManifest => {
  const requiredPackages = Object.freeze([...packages]);
  const generatedFiles=Object.freeze([...common,...feature(featurePath,entity)]);
  const minimumVersions=Object.freeze(Object.fromEntries(requiredPackages.map(pkg => [pkg, "0.0.0"])));
  const compilerCapabilities=requiredPackages.map(pkg=>pkg.replace("@zaakiyjs/",""))
    .filter(pkg=>["core","signals","dom","styles","router","forms","async","ui","ui-primitives","motion","http"].includes(pkg)) as TemplateCapability[];
  const assets=Object.freeze(generatedFiles.map(path=>Object.freeze({
    path,encoding:"utf-8" as const,mode:"file" as const,
    contentSha256:templateAssetChecksums[id]?.[path] ?? ""
  })));
  return Object.freeze({
    schemaVersion:1, id, version:"0.1.0",kind:"project" as const,
    license:"UNLICENSED",entry:"src/main.tsx",name, description, category,
    packages:minimumVersions,assets,
    compatibility:Object.freeze({
      compiler:"0.0.0",domAbi:1 as const,irSchema:1 as const,
      requiredFeatures:Object.freeze(compilerCapabilities)
    }),
    status:"draft" as const,
    requiredPackages,
    minimumVersions,
    requiredFeatures:Object.freeze([...features]),
    optionSchema:options, featureFlags:Object.freeze({mfa:id==="authentication"}),
    generatedFiles,
    limitations:Object.freeze([...limitations])
  });
};
const commonLimitations = [
  "Full clean-room compiler, Vite, accessibility and browser gates not yet evidenced.",
  "Generated dependencies use workspace:^ and require a local ZaakiyJS monorepo; not a published npm starter.",
  "CLI registry adapter is not merged; this package only returns immutable plans and materialized source."
] as const;
const registry: Readonly<Record<TemplateId, TemplateManifest>> = Object.freeze({
  dashboard:define("dashboard","dashboard","Operations dashboard",
    "Responsive KPI overview with accessible activity, filters and fixture repository.",
    ["@zaakiyjs/core","@zaakiyjs/dom","@zaakiyjs/signals","@zaakiyjs/async","@zaakiyjs/styles","@zaakiyjs/vite-plugin"],
    ["signals","owner-cleanup","resource-cancellation","keyed-loops","brand-tokens"],
    "dashboard","dashboard",[...commonLimitations,"Chart integration deliberately omitted."]),
  authentication:define("authentication","authentication","Authentication flows",
    "Sign-in, sign-up, recovery, reset and session expiry; backend required for identity.",
    ["@zaakiyjs/core","@zaakiyjs/dom","@zaakiyjs/signals","@zaakiyjs/forms","@zaakiyjs/styles","@zaakiyjs/vite-plugin"],
    ["forms","verified-server-auth","csrf-session-security","brand-tokens"],
    "auth","auth",[...commonLimitations,"No default production authentication implementation."]),
  settings:define("settings","settings","Account settings",
    "Typed profile, appearance, notifications, accessibility and optimistic concurrency.",
    ["@zaakiyjs/core","@zaakiyjs/dom","@zaakiyjs/signals","@zaakiyjs/forms","@zaakiyjs/styles","@zaakiyjs/vite-plugin"],
    ["forms","versioned-repository","owner-cleanup","brand-tokens"],
    "settings","settings",commonLimitations),
  crud:define("crud","data-management","Product management",
    "Typed list, detail, create, edit, deletion confirmation and cancellable repository access.",
    ["@zaakiyjs/core","@zaakiyjs/dom","@zaakiyjs/signals","@zaakiyjs/forms","@zaakiyjs/async","@zaakiyjs/styles","@zaakiyjs/vite-plugin"],
    ["forms","resource-cancellation","keyed-loops","mutation-confirmation","brand-tokens"],
    "products","product",commonLimitations)
});
/** Stable alphabetical catalog, detached immutable descriptors. */
export function listTemplates(): readonly TemplateManifest[] {
  return Object.freeze(Object.keys(registry).sort().map(id => registry[id as TemplateId]));
}
export function getTemplate(id: TemplateId): TemplateManifest | undefined {
  return Object.hasOwn(registry,id) ? registry[id] : undefined;
}
