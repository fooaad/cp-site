// Turns engine-specific crash messages (Chrome, Safari, Firefox) into something a CP user can act on.
export function describeRuntimeError(message: string): string {
  if (/call stack|too much recursion/i.test(message)) {
    return (
      'Stack overflow: recursion is too deep for the browser (it allows only a few thousand levels). ' +
      'Rewrite deep recursion (e.g. DFS) with an explicit stack.'
    )
  }
  if (/unreachable/i.test(message)) {
    return 'The program aborted: a failed assert, vector::at out of range, out of memory, or another library error.'
  }
  if (/out of bounds|memory access/i.test(message)) {
    return 'Invalid memory access: an index out of range or a bad pointer.'
  }
  if (/divi(de|sion) by zero/i.test(message)) return 'Integer division by zero.'
  if (/integer overflow/i.test(message)) return 'Integer overflow in division (INT_MIN / -1).'
  return message
}
