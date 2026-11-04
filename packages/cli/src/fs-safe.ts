import {randomUUID} from "node:crypto";
import {lstat, mkdir, mkdtemp, rename, rm, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {CliError} from "./args.js";

export interface PlannedWrite { path: string; content: string }
const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;
function safeSegment(name: string): boolean {
  return name.length > 0 && name.length <= 120 && !reserved.test(name) &&
    !/[<>:"|?*]/.test(name) && ![...name].some(char => char.charCodeAt(0) < 32) && !/[. ]$/.test(name);
}
export function validateProjectName(name: string): string {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) || name.length > 100 || reserved.test(name)) {
    throw new CliError("INVALID_PROJECT_NAME", "Project name must be lowercase kebab-case, start with a letter, and contain no reserved path names.");
  }
  return name;
}
export function safeRelativePath(value: string): string {
  if (!value || isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.startsWith("\\\\") || value.startsWith("//")) {
    throw new CliError("UNSAFE_PATH", "Use a relative path inside the target project.");
  }
  const segments = value.replace(/\\/g, "/").split("/");
  if (segments.some(segment => segment === ".." || !safeSegment(segment))) {
    throw new CliError("UNSAFE_PATH", "Unsafe path segment in " + value);
  }
  return segments.join("/");
}
export function safeDestination(root: string, relativeName: string): string {
  const target = resolve(root, safeRelativePath(relativeName));
  const rel = relative(resolve(root), target);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new CliError("UNSAFE_PATH", "Output escapes project directory.");
  return target;
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function ensureNoSymlinkAncestors(root: string, path: string): Promise<void> {
  const base = resolve(root);
  const rel = relative(base, path);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new CliError("UNSAFE_PATH", "Output escapes project directory.");
  const baseInfo = await lstat(base);
  if (baseInfo.isSymbolicLink()) throw new CliError("SYMLINK_PATH", "Refusing symlink root: " + base);
  let current = base;
  for (const segment of rel.split(sep)) {
    current = join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) throw new CliError("SYMLINK_PATH", "Refusing to write through symlink: " + current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
function validatePlan(root: string, files: readonly PlannedWrite[]): PlannedWrite[] {
  const paths = new Set<string>();
  return files.map(file => {
    const path = safeRelativePath(file.path);
    safeDestination(root, path);
    const key = path.toLowerCase();
    if (paths.has(key)) throw new CliError("DUPLICATE_PATH", "Duplicate generated path: " + path);
    paths.add(key);
    return {path, content: file.content.replace(/\r\n/g, "\n")};
  });
}
export async function writeProject(parent: string, name: string, files: readonly PlannedWrite[], options: {dryRun: boolean; force: boolean}): Promise<string[]> {
  const root = resolve(parent);
  const target = safeDestination(root, validateProjectName(name));
  const plan = validatePlan(target, files);
  if (options.dryRun) return plan.map(file => name + "/" + file.path);
  await mkdir(root, {recursive: true});
  await ensureNoSymlinkAncestors(dirname(root), root);
  if (await exists(target) && !options.force) throw new CliError("PROJECT_EXISTS", "Directory already exists: " + target + " (use --force to replace explicitly)");
  const stage = await mkdtemp(join(root, ".zaakiy-stage-"));
  const backup = join(root, ".zaakiy-backup-" + randomUUID());
  let backedUp = false, committed = false;
  try {
    for (const file of plan) {
      const staged = safeDestination(stage, file.path);
      await mkdir(dirname(staged), {recursive: true});
      await writeFile(staged, file.content, {encoding: "utf8", flag: "wx"});
    }
    if (await exists(target)) {
      await ensureNoSymlinkAncestors(root, target);
      await rename(target, backup);
      backedUp = true;
    }
    await rename(stage, target);
    committed = true;
    if (backedUp) await rm(backup, {recursive: true, force: true});
    return plan.map(file => join(name, file.path));
  } catch (error) {
    if (backedUp && !committed) await rename(backup, target);
    throw error;
  } finally {
    if (!committed) await rm(stage, {recursive: true, force: true});
  }
}
export async function writeGenerated(rootPath: string, files: readonly PlannedWrite[], options: {dryRun: boolean; force: boolean}): Promise<string[]> {
  const root = resolve(rootPath);
  const plan = validatePlan(root, files);
  for (const file of plan) {
    const path = safeDestination(root, file.path);
    await ensureNoSymlinkAncestors(root, path);
    if (await exists(path) && !options.dryRun) {
      const info = await lstat(path);
      if (!info.isFile()) throw new CliError("DIRECTORY_COLLISION", "Refusing to overwrite non-file path " + path);
      if (!options.force) throw new CliError("FILE_EXISTS", "File already exists: " + path + " (use --force to replace explicitly)");
    }
  }
  if (options.dryRun) return plan.map(file => file.path);
  const stage = await mkdtemp(join(root, ".zaakiy-stage-"));
  const touched: string[] = [];
  const backups = new Map<string, string>();
  try {
    for (const file of plan) {
      const source = safeDestination(stage, file.path);
      await mkdir(dirname(source), {recursive: true});
      await writeFile(source, file.content, {encoding: "utf8", flag: "wx"});
    }
    for (const file of plan) {
      const destination = safeDestination(root, file.path);
      await mkdir(dirname(destination), {recursive: true});
      await ensureNoSymlinkAncestors(root, destination);
      if (await exists(destination)) {
        const backup = join(stage, "backup-" + randomUUID());
        await rename(destination, backup);
        backups.set(destination, backup);
        touched.push(destination);
      }
      await rename(safeDestination(stage, file.path), destination);
      if (!backups.has(destination)) touched.push(destination);
    }
    return plan.map(file => file.path);
  } catch (error) {
    for (const destination of touched.reverse()) {
      const backup = backups.get(destination);
      if (backup) {await rm(destination, {force: true}); await rename(backup, destination);}
      else await rm(destination, {force: true});
    }
    throw error;
  } finally {
    await rm(stage, {recursive: true, force: true});
  }
}
