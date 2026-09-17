// 잡아야 한다 — 브라우저가 공급사 시트 주소를 «직접» 부른다.
export async function 되살리기() {
  const r = await fetch('/api/sheet/live-status');
  return r.json() as Promise<unknown>;
}
