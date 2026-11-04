# Recurrence CLI

## Install

With Node.js 22 or newer, install the latest version supported by the installer without npm or Git:

```sh
curl -fsSL https://raw.githubusercontent.com/Open-Interaction/recurrence-cli/main/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
recurrence --help
```

The installer downloads the tagged CLI source over HTTPS and installs it in `~/.local/bin` and `~/.local/share/recurrence-cli`. Add `~/.local/bin` to your `PATH` if needed, then rerun the command to update. To install a specific release or choose another location:

```sh
curl -fsSL https://raw.githubusercontent.com/Open-Interaction/recurrence-cli/main/install.sh | RECURRENCE_VERSION=v0.2.0 RECURRENCE_INSTALL_PREFIX="$HOME/.local" sh
```

The CLI is not published to the npm registry. You can also install it from the public GitHub repository with npm:

```sh
npm install -g 'git+https://github.com/Open-Interaction/recurrence-cli.git#v0.2.0'
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
