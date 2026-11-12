#!/bin/sh
# Call through scripts/with-external-cache.sh; Zig 0.15.2 and an exact Apple LZFSE checkout are required.
set -eu
: "${TMPDIR:?Use scripts/with-external-cache.sh}"
: "${LUMA_LZFSE_SOURCE:?Set path to lzfse/lzfse at e634ca58b4821d9f3d560cdc6df5dec02ffc93fd}"
: "${LUMA_ZIG:=zig}"
expected=e634ca58b4821d9f3d560cdc6df5dec02ffc93fd
test "$(git -C "$LUMA_LZFSE_SOURCE" rev-parse HEAD)" = "$expected"
test -z "$(git -C "$LUMA_LZFSE_SOURCE" status --porcelain)"
test "$("$LUMA_ZIG" version)" = 0.15.2
cd "$(dirname "$0")/../.."
export ZIG_GLOBAL_CACHE_DIR="$TMPDIR/luma-lzfse/zig-cache" ZIG_LOCAL_CACHE_DIR="$TMPDIR/luma-lzfse/local-cache"
sources="$LUMA_LZFSE_SOURCE/src"
"$LUMA_ZIG" cc -target wasm32-wasi -mexec-model=reactor -Oz -DNDEBUG -Wl,--export=input -Wl,--export=output \
  -Wl,--export=decode -Wl,--strip-all -I"$sources" scripts/lzfse/decoder.c \
  "$sources/lzfse_decode_base.c" "$sources/lzfse_fse.c" "$sources/lzvn_decode_base.c" -o public/sync-assets/lzfse.wasm
cp "$LUMA_LZFSE_SOURCE/LICENSE" public/sync-assets/LZFSE-LICENSE.txt
