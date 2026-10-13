// Stand-in for GCC's <bits/stdc++.h>, which libc++ doesn't ship.
// Every standard header that compiles for wasm32-wasi, minus ones deprecated or removed in C++20.
// Left out because they don't build on this target: <csetjmp>, <csignal>.
const HEADERS = [
  // C library
  'cassert', 'cctype', 'cerrno', 'cfenv', 'cfloat', 'cinttypes', 'climits', 'clocale', 'cmath',
  'cstdarg', 'cstddef', 'cstdint', 'cstdio', 'cstdlib', 'cstring', 'ctime', 'cuchar', 'cwchar', 'cwctype',
  // C++ library
  'algorithm', 'any', 'array', 'atomic', 'barrier', 'bit', 'bitset', 'charconv', 'chrono', 'compare',
  'complex', 'concepts', 'condition_variable', 'coroutine', 'deque', 'exception', 'execution', 'expected',
  'filesystem', 'flat_map', 'flat_set', 'format', 'forward_list', 'fstream', 'functional', 'future',
  'initializer_list', 'iomanip', 'ios', 'iosfwd', 'iostream', 'istream', 'iterator', 'latch', 'limits',
  'list', 'locale', 'map', 'mdspan', 'memory', 'memory_resource', 'mutex', 'new', 'numbers', 'numeric',
  'optional', 'ostream', 'print', 'queue', 'random', 'ranges', 'ratio', 'regex', 'scoped_allocator',
  'semaphore', 'set', 'shared_mutex', 'source_location', 'span', 'sstream', 'stack', 'stdexcept',
  'stop_token', 'streambuf', 'string', 'string_view', 'syncstream', 'system_error', 'thread', 'tuple',
  'type_traits', 'typeindex', 'typeinfo', 'unordered_map', 'unordered_set', 'utility', 'valarray',
  'variant', 'vector', 'version',
]

export const BITS_STDCXX_H = `#pragma once\n${HEADERS.map((h) => `#include <${h}>`).join('\n')}\n`
