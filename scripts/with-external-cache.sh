#!/bin/sh
set -eu
if [ "$(uname)" = Darwin ]; then
  test -d '/Volumes/Jarvis SSD/DeveloperData' || { echo 'External SSD is not mounted; refusing internal caches.' >&2; exit 1; }
  cache='/Volumes/Jarvis SSD/DeveloperData/Caches/luma-widget-manager'
  mkdir -p "$cache/node_modules" "$cache/next" "$cache/npm" "$cache/tmp"
  for entry in node_modules .next; do
    target="$cache/node_modules"
    test "$entry" != .next || target="$cache/next"
    if [ ! -e "$entry" ] && [ ! -L "$entry" ]; then ln -s "$target" "$entry"; fi
    test -L "$entry" && test "$(readlink "$entry")" = "$target" || { echo "Refusing non-external $entry; migrate it to $target first." >&2; exit 1; }
  done
  export TMPDIR="$cache/tmp" npm_config_cache="$cache/npm"
  if [ "${1:-}" = npm ] && [ "${2:-}" = ci ]; then
    cp package.json package-lock.json "$cache/"
    cd "$cache"
  fi
fi
exec "$@"
