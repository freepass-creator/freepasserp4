// 잡으면 안 된다 — 화면은 ERP 가 아는 것만 부른다.
export async function 목록() {
  const r = await fetch('/api/catalog/feed');
  return r.json() as Promise<unknown>;
}
