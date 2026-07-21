/** Set 불변 토글 SSOT — 페이지마다 손롤로 반복되던 add/delete 로직을 하나로. 항상 새 Set 반환. */
export function toggleInSet<T>(set: Set<T>, v: T): Set<T> {
  const n = new Set(set);
  n.has(v) ? n.delete(v) : n.add(v);
  return n;
}
