import { createControlledHandle, finite } from "./lifecycle.js";
import type { AnimationHandle, SpringOptions } from "./types.js";

/** A bounded semi-implicit Euler scalar spring; no global reactive scheduler. */
export function createSpring(options: SpringOptions): AnimationHandle {
  let position = finite(options.from, "from", -Number.MAX_VALUE);
  const target = finite(options.to, "to", -Number.MAX_VALUE);
  const stiffness = finite(options.stiffness ?? 170, "stiffness", Number.EPSILON);
  const damping = finite(options.damping ?? 26, "damping");
  const mass = finite(options.mass ?? 1, "mass", Number.EPSILON);
  let velocity = finite(options.velocity ?? 0, "velocity", -Number.MAX_VALUE);
  const restSpeed = finite(options.restSpeed ?? 0.01, "restSpeed", Number.EPSILON);
  const restDelta = finite(options.restDelta ?? 0.01, "restDelta", Number.EPSILON);
  // Semi-implicit integration requires a bounded condition number and finite
  // values; unbounded user input can otherwise create Infinity/NaN frames.
  if (Math.abs(position) > 1e9 || Math.abs(target) > 1e9 ||
      Math.abs(velocity) > 1e6 || stiffness / mass > 1e5 ||
      damping / mass > 1e3 || restSpeed > 1e6 || restDelta > 1e9) {
    throw new RangeError("Spring parameters exceed stable scalar limits");
  }
  const control = createControlledHandle(options);
  if (control.handle.status !== "idle") return control.handle;

  try { options.onUpdate(position); }
  catch (error) {
    control.settle({ status: "failed", reason: "error", error });
    return control.handle;
  }
  if (control.reduced || (position === target && Math.abs(velocity) < restSpeed) ||
      typeof requestAnimationFrame !== "function") {
    try { options.onUpdate(target); }
    catch (error) {
      control.settle({ status: "failed", reason: "error", error }); return control.handle;
    }
    control.settle(control.reduced ? { status: "skipped", reason: "reduced-motion" } :
      position === target ? { status: "finished" } : { status: "skipped", reason: "unsupported" });
    return control.handle;
  }

  let frame: number | null = null;
  let last: number | null = null;
  let paused = false;
  const step = (now: number): void => {
    frame = null;
    if (paused || control.handle.status !== "running") return;
    const elapsed = last === null ? 16.667 : Math.max(0, Math.min(64, now - last));
    last = now;
    // Bound each substep by both the natural frequency and damping rate.
    // This avoids numerical instability under otherwise valid stiff springs.
    const rate = Math.max(Math.sqrt(stiffness / mass), damping / mass);
    const maxStepMs = Math.min(8, 250 / rate);
    const steps = Math.max(1, Math.ceil(elapsed / maxStepMs));
    const dt = elapsed / steps / 1000;
    for (let i = 0; i < steps; i++) {
      const acceleration = (stiffness * (target - position) - damping * velocity) / mass;
      velocity += acceleration * dt;
      position += velocity * dt;
    }
    if (!Number.isFinite(position) || !Number.isFinite(velocity)) {
      control.settle({ status: "failed", reason: "error", error: new RangeError("Spring integration produced a non-finite state") });
      return;
    }
    const done = Math.abs(velocity) <= restSpeed && Math.abs(target - position) <= restDelta;
    if (done) { position = target; velocity = 0; }
    try { options.onUpdate(position); }
    catch (error) { control.settle({ status: "failed", reason: "error", error }); return; }
    if (done) {
      control.settle({ status: "finished" });
    } else if (control.handle.status === "running") {
      frame = requestAnimationFrame(step);
    }
  };
  control.start({
    stop() { if (frame !== null) cancelAnimationFrame(frame); frame = null; },
    finish() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      position = target;
      options.onUpdate(target);
    },
    pause() {
      paused = true;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    },
    resume() { paused = false; last = null; frame = requestAnimationFrame(step); }
  });
  frame = requestAnimationFrame(step);
  return control.handle;
}
