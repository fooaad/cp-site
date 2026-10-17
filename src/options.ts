// Compiler and checking options, chosen in the Settings panel and saved in the browser.

export const STANDARDS = ['c++17', 'c++20', 'c++23'] as const
export const OPTIMIZATIONS = ['-O2', '-O0'] as const
// How far decimal answers may be off (absolute or relative error); 'exact' compares text only.
export const TOLERANCES = ['exact', '1e-4', '1e-6', '1e-9'] as const

export type Options = {
  std: (typeof STANDARDS)[number]
  opt: (typeof OPTIMIZATIONS)[number]
  tolerance: (typeof TOLERANCES)[number]
}

export const DEFAULT_OPTIONS: Options = { std: 'c++20', opt: '-O2', tolerance: '1e-6' }

// Fields missing from older saved options fall back to their defaults.
export function parseOptions(value: unknown): Options {
  const v = value as Partial<Options> | null
  return {
    std: STANDARDS.find((s) => s === v?.std) ?? DEFAULT_OPTIONS.std,
    opt: OPTIMIZATIONS.find((o) => o === v?.opt) ?? DEFAULT_OPTIONS.opt,
    tolerance: TOLERANCES.find((t) => t === v?.tolerance) ?? DEFAULT_OPTIONS.tolerance,
  }
}

export const stdLabel = (std: Options['std']) => std.replace('c++', 'C++')
