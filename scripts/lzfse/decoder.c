#include "lzfse_internal.h"

#define LIMIT 256000
static uint8_t source[LIMIT], target[LIMIT + 1];
static lzfse_decoder_state state;

uint8_t *input(void) { return source; }
uint8_t *output(void) { return target; }

int decode(unsigned size, unsigned expected) {
  if (!size || size > LIMIT || !expected || expected > LIMIT) return 0;
  memset(&state, 0, sizeof(state));
  state.src = state.src_begin = source;
  state.src_end = source + size;
  state.dst = state.dst_begin = target;
  state.dst_end = target + expected + 1;
  return lzfse_decode(&state) == LZFSE_STATUS_OK && state.end_of_stream &&
    state.src == state.src_end && state.dst == target + expected;
}
