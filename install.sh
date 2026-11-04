#!/bin/sh
set -eu

fail() {
  printf 'recurrence installer: %s\n' "$1" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail 'curl is required.'
command -v tar >/dev/null 2>&1 || fail 'tar is required.'
command -v node >/dev/null 2>&1 || fail 'Node.js 22 or newer is required.'

node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
[ "$node_major" -ge 22 ] || fail 'Node.js 22 or newer is required.'

version=${RECURRENCE_VERSION:-latest}
if [ "$version" = latest ]; then
  latest_url=$(curl --proto '=https' --proto-redir '=https' -fsSL -o /dev/null -w '%{url_effective}' \
    https://github.com/Open-Interaction/recurrence-cli/releases/latest)
  version=${latest_url##*/}
fi
case "$version" in
  v[0-9]*) ;;
  *) fail 'RECURRENCE_VERSION must be a release tag such as v0.1.0.' ;;
esac
case "$version" in
  *[!A-Za-z0-9._-]*) fail 'RECURRENCE_VERSION contains invalid characters.' ;;
esac

if [ -n "${RECURRENCE_INSTALL_PREFIX:-}" ]; then
  prefix=$RECURRENCE_INSTALL_PREFIX
else
  [ -n "${HOME:-}" ] || fail 'HOME or RECURRENCE_INSTALL_PREFIX is required.'
  prefix=$HOME/.local
fi
mkdir -p "$prefix/bin" "$prefix/share/recurrence-cli"
prefix=$(CDPATH= cd "$prefix" && pwd -P)
target=$prefix/share/recurrence-cli/$version
link=$prefix/bin/recurrence

if [ -e "$link" ] || [ -L "$link" ]; then
  [ -L "$link" ] || fail "$link already exists and is not a symlink."
  case "$(readlink "$link")" in
    "$prefix/share/recurrence-cli/"*) ;;
    *) fail "$link points to another installation." ;;
  esac
fi

temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/recurrence-cli.XXXXXX")
trap 'rm -rf "$temp_dir"' EXIT
trap 'exit 1' HUP INT TERM

archive=$temp_dir/source.tar.gz
asset=
case "$version" in
  v0.1.*|v0.2.*)
    url=https://codeload.github.com/Open-Interaction/recurrence-cli/tar.gz/refs/tags/$version
    source_dir=$temp_dir/recurrence-cli-${version#v}
    ;;
  *)
    asset=recurrence-cli-${version#v}.tgz
    url=https://github.com/Open-Interaction/recurrence-cli/releases/download/$version/$asset
    source_dir=$temp_dir/package
    curl --proto '=https' --proto-redir '=https' -fsSL \
      "https://github.com/Open-Interaction/recurrence-cli/releases/download/$version/SHA256SUMS" -o "$temp_dir/SHA256SUMS"
    ;;
esac
curl --proto '=https' --proto-redir '=https' -fsSL "$url" -o "$archive"
if [ -n "${asset:-}" ]; then
  node --input-type=module -e '
    import { createHash } from "node:crypto";
    import { readFileSync } from "node:fs";
    const [archive, sums, name] = process.argv.slice(1);
    const expected = readFileSync(sums, "utf8").split(/\r?\n/).find(line => line.endsWith(`  ${name}`))?.split("  ")[0];
    const actual = createHash("sha256").update(readFileSync(archive)).digest("hex");
    if (!expected || actual !== expected) { console.error("Release checksum verification failed."); process.exit(1); }
  ' "$archive" "$temp_dir/SHA256SUMS" "$asset"
fi
tar -xzf "$archive" -C "$temp_dir"
[ -f "$source_dir/bin/recurrence.mjs" ] || fail 'The release archive is missing the CLI entrypoint.'
node -e 'if (require(process.argv[1]).version !== process.argv[2]) process.exit(1)' \
  "$source_dir/package.json" "${version#v}" || fail 'The release archive version does not match its tag.'

if [ -n "${asset:-}" ]; then
  [ -f "$source_dir/dist/cli.mjs" ] || fail 'The release archive is missing the bundled runtime.'
  mkdir -p "$target/dist"
  cp -R "$source_dir/dist/." "$target/dist/"
else
  [ -f "$source_dir/src/cli.mjs" ] || fail 'The release archive is missing the CLI source.'
  mkdir -p "$target/src"
  cp "$source_dir/src/"*.mjs "$target/src/"
fi
mkdir -p "$target/bin"
cp "$source_dir/bin/recurrence.mjs" "$target/bin/recurrence.mjs"
cp "$source_dir/package.json" "$target/package.json"
chmod 755 "$target/bin/recurrence.mjs"
ln -sfn "$target/bin/recurrence.mjs" "$link"

printf 'Installed Recurrence CLI %s at %s\n' "$version" "$link"
case ":$PATH:" in
  *":$prefix/bin:"*) ;;
  *) printf 'Add %s to PATH to run recurrence.\n' "$prefix/bin" ;;
esac
