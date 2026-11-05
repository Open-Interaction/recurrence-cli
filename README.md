# Recurrence CLI

## Install

With Node.js 22 or newer, install the latest published release without npm or Git:

```sh
curl -fsSL https://raw.githubusercontent.com/Open-Interaction/recurrence-cli/main/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
recurrence --help
```

The installer resolves GitHub's Latest Release, downloads its package over HTTPS, verifies its SHA-256 checksum, and installs it in `~/.local/bin` and `~/.local/share/recurrence-cli`. The package includes the MCP runtime and needs no npm install. Add `~/.local/bin` to your `PATH` if needed, then rerun the command to update. To install a specific release or choose another location:

```sh
curl -fsSL https://raw.githubusercontent.com/Open-Interaction/recurrence-cli/main/install.sh | RECURRENCE_VERSION=v0.3.0 RECURRENCE_INSTALL_PREFIX="$HOME/.local" sh
```

The CLI is not published to the npm registry. You can also install it from the public GitHub repository with npm:

```sh
npm install -g 'git+https://github.com/Open-Interaction/recurrence-cli.git#v0.3.0'
recurrence --help
```

If you cloned this repository, `npm install -g .` installs the checked-out version. In the private monorepo checkout, use `npm install -g ./apps/cli` instead.

Create a platform API key in the web console, then save it locally with a hidden terminal prompt:

```sh
recurrence auth login
recurrence auth status
recurrence models
recurrence balance
recurrence activity --limit 20
```

The key is stored in `~/.config/recurrence/credentials` (or under `XDG_CONFIG_HOME`) with owner-only permissions. `auth status` reports whether a key is configured; it does not verify that the key is still valid. `recurrence auth logout` removes the local copy but does not revoke the key on the server. Revoke keys in the web console. For CI, set `RECURRENCE_API_KEY` in the environment instead; it takes precedence over the saved key. Never put a key in a command argument or a decision JSON file.

Run a decision from a JSON file:

```json
{
  "model": "cloudflare/clef-flash",
  "state": "hello",
  "questions": {
    "greeting": { "type": "noul", "instructions": "Is this a greeting?" }
  }
}
```

```sh
recurrence decide --file decision.json
recurrence status dec_your_request_id
```

The CLI prints an `Idempotency-Key` to stderr before submitting. Save that ID with your input. If the network fails or the outcome is uncertain, retry the **same** input with `--idempotency-key ID`; do not generate a new ID until the prior request is resolved. You can also pipe JSON with `--file -`. Responses are JSON on stdout, so they can be piped to other tools.

`models` is public. `decide` requires `decisions:write`; `activity` and `status` require `decisions:read`; `balance` requires `billing:read`. The CLI uses `https://open-interaction.fly.dev` by default. Set `RECURRENCE_API_ORIGIN` to another HTTPS origin, or to an HTTP localhost origin for local development. Use `recurrence --version` to see the installed CLI version.

## MCP

`recurrence mcp` runs a local stdio MCP server. It uses the same saved key and environment settings as the CLI. Run `recurrence auth login` in your terminal first; no key needs to be placed in an MCP configuration file. The host starts the process and communicates over stdin/stdout; diagnostics go to stderr.

| Tool | Purpose | Required scope |
| --- | --- | --- |
| `list_models` | Model capabilities and prices | Public |
| `create_decision` | Run a decision using account credit | `decisions:write` |
| `get_decision` | Request status, usage, and cost | `decisions:read` |
| `list_activity` | Recent requests | `decisions:read` |
| `get_balance` | Credit and usage summary | `billing:read` |

`create_decision` requires an explicit `idempotencyKey`. New requests need a new key; retries must reuse the same key and exact input. The server does not retry requests automatically. Failed results retain the key and any API request ID. Account and key budgets are enforced by the existing API. Status queries do not return cached answers.

For Codex, register the installed executable ([official configuration guide](https://developers.openai.com/codex/mcp)):

```sh
codex mcp add recurrence -- "$HOME/.local/bin/recurrence" mcp
```

For decisions that may take longer than the client's default timeout, set `tool_timeout_sec = 150` in the `[mcp_servers.recurrence]` entry of `~/.codex/config.toml`.

For Claude Code ([official configuration guide](https://code.claude.com/docs/en/mcp)):

```sh
claude mcp add --transport stdio --scope user recurrence -- "$HOME/.local/bin/recurrence" mcp
```

For clients accepting `mcpServers` JSON, replace the path below with the absolute path printed by `command -v recurrence`:

```json
{
  "mcpServers": {
    "recurrence": {
      "command": "/absolute/path/to/recurrence",
      "args": ["mcp"]
    }
  }
}
```

The host must have Node.js 22+ on its PATH and access to the same home/config directory used for login. When running under another user or in a container, pass `RECURRENCE_API_KEY` through the host's secret/environment settings. Configure the host's tool timeout to allow the API's 120-second decision timeout. After configuration, restart or reconnect the host and ask it to list Recurrence models first.

## Agent skill

The [Recurrence skill](skills/recurrence/SKILL.md) helps an agent decide when to use Recurrence, choose a model from the live catalog, and recover an interrupted request. It prefers the connected MCP server and can also use the CLI. Install the CLI and run `recurrence auth login` before making decisions. A decision can use account credit.

To install the skill for Codex, run these commands from a directory where you can clone the repository:

```sh
git clone --depth 1 https://github.com/Open-Interaction/recurrence-cli.git
recurrence_skill_dir="${CODEX_HOME:-$HOME/.codex}/skills/recurrence"
mkdir -p "$recurrence_skill_dir"
cp -R recurrence-cli/skills/recurrence/. "$recurrence_skill_dir/"
```

Open a new Codex session and try this prompt:

> Use `$recurrence` to classify the ticket “I was charged twice for the same invoice” as `billing`, `technical`, or `other`. Choose a model from the live catalog and report the label, model, request ID, and charge.

If the response is lost, keep the original model, payload, and idempotency key. Check status first if you have a decision ID. See the [decision input guide](skills/recurrence/references/decision-input.md) for a complete example and the [skill](skills/recurrence/SKILL.md#recover-safely) for when to replay or stop.

## Development and release

This repository mirrors the platform's `apps/cli` directory. Maintainers make source changes there and sync them to this public repository.

For standalone CI/builds, use `npm ci --ignore-scripts`, then `npm test` and `npm run typecheck`. `package-lock.json` fixes that dependency graph; the private monorepo continues to use its root pnpm lock for workspace development. The MCP tests use the official SDK client over both in-memory and real stdio transports against a local mock API.

To release, increase `package.json` and `package-lock.json` to a new stable version, add the matching `CHANGELOG.md` section, and merge the source change. Once synchronized to public `main`, the version change automatically starts **CLI release**. That workflow tests, packs, verifies the extracted runtime, creates the tag and a draft Release, uploads and checks the exact package/checksum assets, and then publishes it as Latest. The installer follows that published pointer automatically. Published tags and assets are never replaced.

For a build-only rehearsal, run **Actions → CLI release → Run workflow** with `publish` unchecked. To retry a release, use the same workflow with `publish` checked. Matching draft uploads are reused; existing published versions are verified, and conflicting tags or assets stop the run. A post-publication installer check can fail after publication; inspect the log and rerun verification rather than replacing the assets.

For local package validation, run `node scripts/release.mjs prepare`. It writes the package, checksums, source manifest, and release notes under ignored `release/`. Publishing runs only in the public main-branch GitHub Actions job. The package includes third-party license notices in `dist/THIRD_PARTY_NOTICES.txt`.
