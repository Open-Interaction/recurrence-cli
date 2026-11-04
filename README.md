# Recurrence CLI

## Install

With Node.js 22 or newer, install the latest version supported by the installer without npm or Git:

```sh
curl -fsSL https://raw.githubusercontent.com/Open-Interaction/recurrence-cli/main/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
recurrence --help
```

The installer downloads the versioned Release package over HTTPS, verifies its SHA-256 checksum, and installs it in `~/.local/bin` and `~/.local/share/recurrence-cli`. The package includes the MCP runtime and needs no npm install. Add `~/.local/bin` to your `PATH` if needed, then rerun the command to update. To install a specific release or choose another location:

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

## Development and release

In the standalone repository, `npm install` builds the bundled runtime via `prepare`; `npm test` runs CLI and MCP tests. In the private monorepo, use `pnpm --filter recurrence-cli build` and `pnpm --filter recurrence-cli test`. The MCP tests use the official SDK client over both in-memory and real stdio transports against a local mock API.

Build before packaging: `npm run build`, then `npm pack --ignore-scripts`. Attach `recurrence-cli-VERSION.tgz` and a `SHA256SUMS` file containing its SHA-256 hash to the matching GitHub Release. Publish the assets before updating the installer's default version on `main`. The package includes bundled third-party license notices in `dist/THIRD_PARTY_NOTICES.txt`.
