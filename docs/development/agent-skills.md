# ZaakiyJS Builder — coding-agent skill

A portable Agent Skill for building applications with ZaakiyJS and for evidence-based maintenance of the framework. It is not a browser runtime package, an MCP server, or a marketplace listing. The canonical source is [.agents/skills/zaakiyjs-builder](../../.agents/skills/zaakiyjs-builder/SKILL.md). It adds no framework dependencies, runtime changes, hooks, network requests, account permissions or API keys.

## Compatibility and installation

Use a current tool version that supports Agent Skills. The shared project location is supported by Codex, Antigravity and current Cursor. Claude Code uses its project skills directory. Official documentation:
[Codex](https://developers.openai.com/api/reference/cli),
[Antigravity](https://antigravity.google/docs/skills),
[Claude Code](https://code.claude.com/docs/en/skills),
[Cursor](https://cursor.com/docs/skills).

| Tool | Project path | Invoke |
| --- | --- | --- |
| Codex | .agents/skills/zaakiyjs-builder/SKILL.md | Select the skill or mention zaakiyjs-builder (e.g. $zaakiyjs-builder where supported) |
| Antigravity | .agents/skills/zaakiyjs-builder/SKILL.md | /zaakiyjs-builder |
| Cursor | .agents/skills/zaakiyjs-builder/SKILL.md (shared) or .cursor/skills/zaakiyjs-builder/SKILL.md | Select or mention zaakiyjs-builder |
| Claude Code | .claude/skills/zaakiyjs-builder/SKILL.md | /zaakiyjs-builder |

In a checkout of this repository the first three can discover the canonical skill immediately. Start a new agent session if discovery is stale. To install for Claude Code from the checkout root:

~~~bash
node .agents/skills/zaakiyjs-builder/scripts/install.mjs --agent claude --project .
~~~

To install into another existing project (substitute its actual path):

~~~bash
node .agents/skills/zaakiyjs-builder/scripts/install.mjs --agent all --project /path/to/my-app --dry-run
node .agents/skills/zaakiyjs-builder/scripts/install.mjs --agent all --project /path/to/my-app
~~~

On Windows PowerShell, use e.g. --project "C:/Projects/my-app". The target directory must already exist. The installer uses Node.js only, installs the complete skill, defaults to no overwrite, refuses symlink destinations, and makes identical reinstalls a no-op. The all option creates one shared .agents copy and one Claude-specific copy; do not separately install an additional Cursor copy unless needed by an older tool version. Tools that discover multiple compatible directories may show duplicate skill entries; select one or remove the unused duplicate yourself.

For a single target, use --agent codex, antigravity, claude or cursor. The Cursor-only option uses .cursor/skills. To update an installed copy that differs, manually review and move/remove that copy before installing; the installer never overwrites customizations. Uninstall by removing only the reviewed zaakiyjs-builder directory. Use trusted local checkouts only. A skill does not change the agent's permissions.

## Example tasks

- "Use zaakiyjs-builder to scaffold a minimal workspace application, build a product list with signal-backed state, and verify its production build and keyed DOM behavior."
- "Use zaakiyjs-builder to implement a typed MVVM CRUD feature with form validation, cancellation, error states and tests."
- "Use zaakiyjs-builder to add a public SEO product page with supported SSR/hydration, matching build identity and a verified client bundle."
- "Use zaakiyjs-builder to review this PR against the frozen main baseline and report actual CI evidence without changing the runtime."

The skill first inspects project state and APIs, then implements one vertical slice and verifies the result. It explicitly refuses invented exports, npm publication claims, unsupported CLI commands and unsafe framework substitutions. Read [application workflow](../../.agents/skills/zaakiyjs-builder/references/application-workflow.md), [API reference](../../.agents/skills/zaakiyjs-builder/references/api-and-architecture.md), and [verification](../../.agents/skills/zaakiyjs-builder/references/verification.md) for the pinned reference.

## Validation and versioning

From the framework checkout:

~~~bash
node --test scripts/agent-skills/skill.test.mjs
node .agents/skills/zaakiyjs-builder/scripts/inspect.mjs --project .
~~~

The dedicated Agent Skills CI tests metadata, reference presence, installer paths, idempotency, dry-run, refusal of divergent files/symlink destinations and read-only inspection behavior. The tests do not launch the four coding agents. End-to-end discovery and agent-generated application acceptance require testing in each actual client with the evaluation prompts in the verification reference. Do not claim marketplace approval or client certification from unit tests.

The API snapshot references main 5fe0e1765bc802ea3f3eebb76a43bd585166c518 and the certified runtime tree. Refresh it when exported APIs change. The checked-out source and installed declarations remain authoritative. Keep the skill canonical rather than editing each installed copy. No npm release or additional marketplace plugin is required for the local skill.
