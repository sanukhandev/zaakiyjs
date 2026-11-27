import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const shaPattern = /^[a-f0-9]{40}$/;
const workflow = name => ".github/workflows/" + name + ".yml";
const legacy = workflow("h4-hydration-locks");
const required = ["quality", "release-hardening", "production-benchmark", "m1-browser-matrix", "cli-generated-app-acceptance"].map(workflow);
// Only these exact release-control files may change after the original version PR.
// Never allow package sources/manifests, locks, build scripts, benchmark definitions, or CI test gates.
const correctionPaths = new Set([
  workflow("npm-publish"), workflow("npm-verify"), workflow("release-version-policy"), legacy,
  "scripts/release/release-ci.mjs", "scripts/release/release-ci.test.mjs",
  "docs/releasing/pr-driven-release.md"
]);
const latest = runs => {
  const byPath = new Map();
  for (const run of runs) {
    assert(typeof run.path === "string" && run.path.startsWith(".github/workflows/"), "Invalid workflow path");
    assert(Number.isInteger(run.run_number) && Number.isInteger(run.run_attempt), "Invalid workflow run sequence");
    const prev = byPath.get(run.path);
    if (!prev || run.run_number > prev.run_number ||
      (run.run_number === prev.run_number && run.run_attempt > prev.run_attempt)) byPath.set(run.path, run);
  }
  return [...byPath.values()];
};
const passed = run => run.status === "completed" && run.conclusion === "success";
function exactRuns(pages, sha, event) {
  assert(Array.isArray(pages) && pages.length > 0 && pages.every(page => Array.isArray(page.workflow_runs)), "Malformed workflow response");
  const runs = pages.flatMap(page => page.workflow_runs);
  assert(runs.length === pages[0].total_count, "Incomplete workflow evidence for " + sha);
  assert(runs.every(run => run.head_sha === sha && run.event === event), "Nonmatching workflow evidence for " + sha);
  return runs;
}
export function validatePushRuns(pages, sha) {
  const runs = latest(exactRuns(pages, sha, "push"));
  assert(runs.every(run => run.head_branch === "main"), "Push evidence is not from main: " + sha);
  const ignored = runs.filter(run => run.path === legacy);
  const active = runs.filter(run => run.path !== legacy);
  const missing = required.filter(path => !active.some(run => run.path === path));
  const failed = active.filter(run => !passed(run)).map(run => run.path + " (" + run.status + "/" + run.conclusion + ", run " + run.id + ")");
  assert(!missing.length && !failed.length,
    "Post-merge CI incomplete for " + sha + "; missing: " + (missing.join(", ") || "none") + "; not passed: " + (failed.join(", ") || "none"));
  return {sha, passed: active.map(run => ({path: run.path, id: run.id})), ignored: ignored.map(run => ({path: run.path, id: run.id, reason: "Retired branch-only comparator lock generator; not a main certification gate"}))};
}
export function validateCorrection(paths, title) {
  assert(/^ci(?:\([a-z0-9-]+\))?:\s+\S/.test(title), "Only explicitly classified ci: correction PRs may follow a release");
  assert(paths.length > 0 && paths.every(path => correctionPaths.has(path)), "Non-release-control change after version PR: " + paths.filter(path => !correctionPaths.has(path)).join(", "));
}
export function certifyRelease({current, plan, git, api}) {
  const source = plan.sourceSha;
  assert(plan.schema === "zaakiy.release/1" && Array.isArray(plan.releases) && plan.releases.length && shaPattern.test(source) && shaPattern.test(current), "Invalid release manifest or certification SHA");
  const rev = args => git(args).trim();
  assert(rev(["rev-parse", "HEAD"]) === current && api("/branches/main").commit.sha === current, "Certification SHA must be exact current main");
  const commits = rev(["rev-list", "--first-parent", "--reverse", source + ".." + current]).split("\n").filter(Boolean);
  assert(commits.length && commits.every(sha => shaPattern.test(sha)) && rev(["rev-parse", commits[0] + "^1"]) === source, "Manifest source must be first parent of the version merge");
  const original = commits[0];
  function verifyPR(commit, release) {
    const pages = api("/commits/" + commit + "/pulls", true);
    assert(Array.isArray(pages) && pages.every(Array.isArray), "Malformed PR association");
    const matches = pages.flat().filter(pr => pr.merged_at && pr.base.ref === "main" && pr.merge_commit_sha === commit);
    assert(matches.length === 1, "Not a unique merged main PR: " + commit);
    const pr = matches[0];
    assert(shaPattern.test(pr.head.sha), "Invalid reviewed PR head");
    if (release) assert(pr.title.startsWith("release:"), "Original version commit is not a generated release PR");
    else validateCorrection(git(["diff", "--name-only", "--no-renames", "-z", commit + "^1", commit]).split("\0").filter(Boolean), pr.title);
    assert(api("/git/commits/" + pr.head.sha).tree.sha === rev(["rev-parse", commit + "^{tree}"]), "Merged tree differs from reviewed PR: " + commit);
    const runs = latest(exactRuns(api("/actions/runs?head_sha=" + pr.head.sha + "&event=pull_request&per_page=100", true), pr.head.sha, "pull_request"));
    const policy = runs.find(run => run.path === workflow("release-version-policy"));
    assert(policy && passed(policy), "Release Version Policy missing or failed for PR #" + pr.number);
    return {number: pr.number, commit, head: pr.head.sha, policyRun: policy.id};
  }
  const versionPR = verifyPR(original, true);
  const corrections = commits.slice(1).map(commit => verifyPR(commit, false));
  // Explicitly recheck the net diff too; an approved correction cannot mutate the manifest.
  if (corrections.length) validateCorrection(git(["diff", "--name-only", "--no-renames", "-z", original, current]).split("\0").filter(Boolean), "ci: verify net release-control diff");
  const push = [...new Set([original, current])].map(sha => validatePushRuns(api("/actions/runs?head_sha=" + sha + "&event=push&per_page=100", true), sha));
  return {releaseCommit: original, certificationCommit: current, versionPR, corrections, push};
}
function main() {
  const git = args => execFileSync("git", args, {encoding:"utf8", maxBuffer:16*1024*1024});
  const api = (path, paginate = false) => JSON.parse(execFileSync("gh", ["api", ...(paginate ? ["--paginate", "--slurp"] : []), "repos/" + process.env.GITHUB_REPOSITORY + path], {encoding:"utf8", maxBuffer:32*1024*1024}));
  assert(process.env.GITHUB_REPOSITORY === "sanukhandev/zaakiyjs" && process.env.GITHUB_REF === "refs/heads/main", "Certification restricted to ZaakiyJS main");
  const evidence = certifyRelease({current:process.env.RELEASE_SHA, plan:JSON.parse(readFileSync(".release/manifest.json", "utf8")), git, api});
  console.log(JSON.stringify(evidence, null, 2));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
