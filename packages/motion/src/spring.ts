import { createControlledHandle, finite } from "./lifecycle.js";
import type { MotionHandle, SpringOptions } from "./types.js";

/** A bounded semi-implicit Euler scalar spring; no global reactive scheduler. */
export function createSpring(options: SpringOptions): MotionHandle {
  let position = finite(options.from, "from", -Number.MAX_VALUE);
  const target = finite(options.to, "to", -Number.MAX_VALUE);
  const stiffness = finite(options.stiffness ?? 170, "stiffness", Number.EPSILON);
  const damping = finite(options.damping ?? 26, "damping");
  const mass = finite(options.mass ?? 1, "mass", Number.EPSILON);
  let velocity = finite(options.velocity ?? 0, "velocity", -Number.MAX_VALUE);
  const restSpeed = finite(options.restSpeed ?? 0.01, "restSpeed", Number.EPSILON);
  const restDelta = finite(options.restDelta ?? 0.01, "restDelta", Number.EPSILON);
  const control = createControlledHandle(options);
  if (control.handle.status !== "idle") return control.handle;

  try { options.onUpdate(position); }
  catch (error) {
    control.settle({ status: "failed", reason: "error", error });
    return control.handle;
  }
  if (control.reduced || (position === target && Math.abs(velocity) < restSpeed) ||
      typeof requestAnimationFrame !== "function") {
    if (control.reduced || position === target) {
      try { options.onUpdate(target); }
      catch (error) {
        control.settle({ status: "failed", reason: "error", error }); return control.handle;
      }
    }
    control.settle({ status: "skipped", reason: control.reduced ? "reduced-motion" : "unsupported" });
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
    const steps = Math.max(1, Math.ceil(elapsed / 8));
    const dt = elapsed / steps / 1000;
    for (let i = 0; i < steps; i++) {
      const acceleration = (stiffness * (target - position) - damping * velocity) / mass;
      velocity += acceleration * dt;
      position += velocity * dt;
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
