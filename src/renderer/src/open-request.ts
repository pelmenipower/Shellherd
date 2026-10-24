/** Whether a picker open request counter should open the picker: only a real change to a positive value. */
export function shouldOpen(previous: number, next: number | undefined): boolean {
  return next !== undefined && next > 0 && next !== previous;
}
