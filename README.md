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
curl -fsSL https://raw.githubusercontent.com/Open-Interaction/recurrence-cli/main/install.sh | RECURRENCE_VERSION=v0.1.0 RECURRENCE_INSTALL_PREFIX="$HOME/.local" sh
```

The CLI is not published to the npm registry. You can also install it from the public GitHub repository with npm:

```sh
npm install -g 'git+https://github.com/Open-Interaction/recurrence-cli.git#v0.1.0'
recurrence --help
```

If you cloned this repository, `npm install -g .` installs the checked-out version. In the private monorepo checkout, use `npm install -g ./apps/cli` instead.

Create a platform API key in the web console, then store it in your shell environment. Do not put the key in a command argument or a JSON input file.

```sh
export RECURRENCE_API_KEY="<your-platform-key>"
recurrence models
recurrence balance
recurrence activity --limit 20
```

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

`models` is public. `decide` requires `decisions:write`; `activity` and `status` require `decisions:read`; `balance` requires `billing:read`. The CLI uses `https://open-interaction.fly.dev` by default. Set `RECURRENCE_API_ORIGIN` to another HTTPS origin, or to an HTTP localhost origin for local development. `status` requires an API deployment that includes `GET /v1/decisions/:requestId`.
