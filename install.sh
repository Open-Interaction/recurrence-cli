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

version=${RECURRENCE_VERSION:-v0.1.0}
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
url=https://codeload.github.com/Open-Interaction/recurrence-cli/tar.gz/refs/tags/$version
curl --proto '=https' --proto-redir '=https' -fsSL "$url" -o "$archive"
tar -xzf "$archive" -C "$temp_dir"
source_dir=$temp_dir/recurrence-cli-${version#v}
[ -f "$source_dir/bin/recurrence.mjs" ] || fail 'The release archive is missing the CLI entrypoint.'
[ -f "$source_dir/src/cli.mjs" ] || fail 'The release archive is missing the CLI source.'
node -e 'if (require(process.argv[1]).version !== process.argv[2]) process.exit(1)' \
  "$source_dir/package.json" "${version#v}" || fail 'The release archive version does not match its tag.'

mkdir -p "$target/bin" "$target/src"
cp "$source_dir/bin/recurrence.mjs" "$target/bin/recurrence.mjs"
cp "$source_dir/src/cli.mjs" "$target/src/cli.mjs"
cp "$source_dir/package.json" "$target/package.json"
chmod 755 "$target/bin/recurrence.mjs"
ln -sfn "$target/bin/recurrence.mjs" "$link"

printf 'Installed Recurrence CLI %s at %s\n' "$version" "$link"
case ":$PATH:" in
  *":$prefix/bin:"*) ;;
  *) printf 'Add %s to PATH to run recurrence.\n' "$prefix/bin" ;;
esac
