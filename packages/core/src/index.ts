/** ZaakiyJS component ownership, lifecycle and typed provider runtime. */
export type {
  ReadonlySignal, WritableSignal, ComputedSignal, EffectHandle, EffectOptions
} from "@zaakiyjs/signals";
export const foundationStatus = { package: "@zaakiyjs/core", implemented: true } as const;
export {
  createOwner, runWithOwner, getOwner, onCleanup, onMount, mountOwner,
  activateOwner, deactivateOwner, suspendOwner, disposeOwner, transferOwner,
  ownDisposable, initializeOwnedComponent
} from "./owner.js";
export type { OwnerScope, OwnerState, Cleanup } from "./owner.js";
export {
  createContext, provide, useContext, requireContext, MissingProviderError
} from "./context.js";
export type { ContextToken } from "./context.js";
export { executeComponent } from "./component.js";
export type { Component, ComponentFactory, ViewNode } from "./component.js";
