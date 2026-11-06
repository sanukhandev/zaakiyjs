import { rmSync } from "node:fs";
import { resolve } from "node:path";

// Package-local output only; never delete caller-controlled paths.
rmSync(resolve("dist"), { recursive: true, force: true });
