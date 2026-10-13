// The browser's native stack overflowed (Chrome/Safari: "Maximum call stack size exceeded",
// Firefox: "too much recursion"). The runner retries these in the interpreter.
export function isStackOverflow(message: string): boolean {
  return /maximum call stack|too much recursion/i.test(message)
}

// Turns engine-specific crash messages (Chrome, Safari, Firefox, wasmi) into something a CP user can act on.
export function describeRuntimeError(message: string, slow = false): string {
  if (isStackOverflow(message)) {
    return 'Stack overflow: recursion is too deep for the browser. Rewrite deep recursion with an explicit stack.'
  }
  if (/call stack exhausted|out of system memory|growth operation limited/i.test(message)) {
    return 'Stack overflow or out of memory, even in slow mode (over 20 million levels of recursion, or too much memory).'
  }
  if (/unreachable/i.test(message)) {
    return 'The program aborted: a failed assert, vector::at out of range, out of memory, or another library error.'
  }
  if (/out of bounds|memory access/i.test(message)) {
    // In slow mode the program already recursed deeply, so running out of stack memory is likely.
    return slow
      ? 'Invalid memory access, most likely the 256 MB stack running out: does the recursion ever stop?'
      : 'Invalid memory access: an index out of range or a bad pointer.'
  }
  if (/divi(de|sion) by zero/i.test(message)) return 'Integer division by zero.'
  if (/integer overflow/i.test(message)) return 'Integer overflow in division (INT_MIN / -1).'
  return message
}
