// Immutable updates for React state. Each returns a new object, or the same one
// when nothing changes, so React can skip the re-render.

/** The set with `item` added. */
export function setWith<T>(set: Set<T>, item: T): Set<T> {
  if (set.has(item)) return set;
  return new Set(set).add(item);
}

/** The set without `items`. */
export function setWithout<T>(set: Set<T>, items: T[]): Set<T> {
  if (!items.some((item) => set.has(item))) return set;
  const next = new Set(set);
  for (const item of items) next.delete(item);
  return next;
}

/** The record without `keys`. */
export function omitKeys<V>(record: Record<number, V>, keys: number[]): Record<number, V> {
  if (!keys.some((key) => key in record)) return record;
  const next = { ...record };
  for (const key of keys) delete next[key];
  return next;
}
