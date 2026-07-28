export function double(value: number): number {
  return value * 2
}

// Lint error: reported by golar's `explicit-anys` rule, not by the type checker.
export function identity(value: any) {
  return value
}
