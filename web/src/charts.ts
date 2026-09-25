/** Small layout helpers the charts share. */

/**
 * End-of-line labels collide where series converge. Given each label's ideal
 * y, return positions pushed apart so that no two are closer than `gap`,
 * keeping their order and moving as little as possible downwards.
 */
export function spreadLabels(ideal: number[], gap = 12): number[] {
  const order = ideal.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed = new Array<number>(ideal.length);
  let previous = Number.NEGATIVE_INFINITY;
  for (const { y, i } of order) {
    const at = Math.max(y, previous + gap);
    placed[i] = at;
    previous = at;
  }
  return placed;
}

/** A value domain padded by a fraction of its span, never zero-width. */
export function paddedDomain(
  values: number[],
  fraction = 0.08,
): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo || 1) * fraction;
  return [lo - pad, hi + pad];
}
