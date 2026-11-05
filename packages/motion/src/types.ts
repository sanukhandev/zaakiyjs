import type { OwnerScope, ReadonlySignal } from "@zaakiyjs/core";

export type ReducedMotionPolicy = "respect" | "always" | "never";
export type AnimationReducedMotionPolicy = "respect" | "disable" | "reduce" | "force";
export type MotionStatus = "idle" | "running" | "paused" | "finished" | "cancelled" | "disposed" | "failed" | "skipped";
export type MotionReason = "explicit" | "owner-disposed" | "signal" | "superseded" |
  "element-removed" | "reduced-motion" | "unsupported" | "error";
export interface MotionOutcome {
  readonly status: "finished" | "cancelled" | "failed" | "skipped";
  readonly reason?: MotionReason;
  readonly error?: unknown;
}
export interface AnimationHandle {
  readonly finished: Promise<MotionOutcome>;
  readonly status: MotionStatus;
  cancel(reason?: MotionReason): void;
  finish(): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}
export interface MotionScopeOptions {
  readonly owner?: OwnerScope;
  readonly signal?: AbortSignal;
  readonly reducedMotion?: AnimationReducedMotionPolicy;
}
export interface ElementAnimationOptions extends MotionScopeOptions {
  readonly keyframes: Keyframe[] | PropertyIndexedKeyframes;
  readonly duration?: number;
  readonly delay?: number;
  readonly endDelay?: number;
  readonly easing?: string;
  readonly fill?: FillMode;
  readonly direction?: PlaybackDirection;
  readonly iterations?: number;
  /** Observe the element's direct parent for permanent removal. Optional cost. */
  readonly observeRemoval?: boolean;
}
export interface SpringOptions extends MotionScopeOptions {
  readonly from: number;
  readonly to: number;
  readonly stiffness?: number;
  readonly damping?: number;
  readonly mass?: number;
  readonly velocity?: number;
  readonly restSpeed?: number;
  readonly restDelta?: number;
  readonly onUpdate: (value: number) => void;
}

/** Frozen public Contract 11 types. These use Signals, not a parallel scheduler. */
export type MotionPhase = "idle" | "running" | "finished" | "cancelled";
export type MotionEndReason = "completed" | "aborted" | "owner-disposed" |
  "superseded" | "reduced-motion" | "unsupported";
export interface MotionResult {
  readonly reason: MotionEndReason;
  readonly phase: "finished" | "cancelled";
}
export interface MotionHandle {
  readonly phase: ReadonlySignal<MotionPhase>;
  readonly finished: Promise<MotionResult>;
  cancel(reason?: MotionEndReason): void;
  dispose(): void;
}
export interface MotionOptions {
  readonly owner: OwnerScope;
  readonly element: Element;
  readonly keyframes: Keyframe[] | PropertyIndexedKeyframes;
  readonly timing: KeyframeAnimationOptions;
  readonly signal?: AbortSignal;
  readonly reducedMotion?: ReducedMotionPolicy;
}
export type PresencePhase = "entering" | "present" | "exiting" | "exited";
export interface PresenceOptions {
  readonly owner: OwnerScope;
  readonly element: Element;
  readonly enter?: Readonly<Pick<MotionOptions, "keyframes" | "timing">>;
  readonly exit?: Readonly<Pick<MotionOptions, "keyframes" | "timing">>;
  readonly reducedMotion?: ReducedMotionPolicy;
}
export interface PresenceController {
  readonly phase: ReadonlySignal<PresencePhase>;
  enter(): MotionHandle;
  exit(signal?: AbortSignal): Promise<MotionResult>;
  dispose(): void;
}
