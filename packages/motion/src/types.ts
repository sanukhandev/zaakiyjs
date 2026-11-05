import type { OwnerScope } from "@zaakiyjs/core";

export type ReducedMotionPolicy = "respect" | "disable" | "reduce" | "force";
export type MotionStatus = "idle" | "running" | "paused" | "finished" | "cancelled" | "disposed" | "failed" | "skipped";
export type MotionReason = "explicit" | "owner-disposed" | "signal" | "superseded" |
  "element-removed" | "reduced-motion" | "unsupported" | "error";
export interface MotionOutcome {
  readonly status: "finished" | "cancelled" | "failed" | "skipped";
  readonly reason?: MotionReason;
  readonly error?: unknown;
}
export interface MotionHandle {
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
  readonly reducedMotion?: ReducedMotionPolicy;
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
