/**
 * 원자 변경 검증 — Firestore 원자의 «상태·대여료»가 지난번 대비 어떻게 바뀌었나 diff.
 *   스냅샷(tmp/atom-snapshot.json)과 비교 → 상태 전이·대여료 변경만 리포트 → 새 스냅샷 저장.
 *   첫 실행 = 기준선(변경 없음). 매 동기 뒤 돌리면 「무엇이 바뀌었나」가 남는다.
 * 읽기(Firestore)전용 + 로컬 스냅샷. --no-save 로 스냅샷 갱신 안 함(조회만).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const SAVE = !process.argv.includes('--no-save');
const S = (v: unknown) => String(v ?? '').trim();
const SNAP = 'tmp/atom-snapshot.json';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\n/g, '\n') }) });
// 대여료 요약(개월→월대여료) — 비교 가능한 평평한 형태
const priceFlat = (price: any): Record<string, number> => {
  const o: Record<string, number> = {};
  if (price && typeof price === 'object') for (const [term, t] of Object.entries(price as Record<string, any>)) if (t && typeof t === 'object' && t.rent != null) o[term] = Number(t.rent);
  return o;
};
const docs = (await getFirestore().collection('products').get()).docs.map((d) => d.data());
const now: Record<string, { st: string; price: Record<string, number> }> = {};
for (const v of docs) { const car = S(v.car_number); if (car) now[car] = { st: S(v.vehicle_status) || '차량검수', price: priceFlat(v.price) }; }

if (!existsSync(SNAP)) {
  if (SAVE) writeFileSync(SNAP, JSON.stringify(now), 'utf8');
  console.log(`기준선 생성 — ${Object.keys(now).length}대 스냅샷 저장(${SNAP}). 다음 실행부터 변경을 잡는다.`);
  process.exit(0);
}
const prev = JSON.parse(readFileSync(SNAP, 'utf8')) as typeof now;
const stChanges: string[] = [], priceChanges: string[] = [], added: string[] = [], removed: string[] = [];
for (const [car, cur] of Object.entries(now)) {
  const p = prev[car];
  if (!p) { added.push(`${car} (${cur.st})`); continue; }
  if (p.st !== cur.st) stChanges.push(`${car}: ${p.st} → ${cur.st}`);
  for (const term of new Set([...Object.keys(p.price), ...Object.keys(cur.price)])) {
    const a = p.price[term], b = cur.price[term];
    if (a !== b) priceChanges.push(`${car} ${term}개월: ${a != null ? a.toLocaleString() : '-'} → ${b != null ? b.toLocaleString() : '-'}`);
  }
}
for (const car of Object.keys(prev)) if (!now[car]) removed.push(car);
console.log(`전 ${Object.keys(now).length}대 (신규 ${added.length} · 사라짐 ${removed.length})`);
console.log(`\n■ 상태 전이 ${stChanges.length}건:`); stChanges.slice(0, 40).forEach((x) => console.log('  ' + x));
console.log(`\n■ 대여료 변경 ${priceChanges.length}건:`); priceChanges.slice(0, 40).forEach((x) => console.log('  ' + x));
if (added.length) { console.log(`\n■ 신규 ${added.length}:`); added.slice(0, 15).forEach((x) => console.log('  ' + x)); }
if (removed.length) { console.log(`\n■ 사라짐 ${removed.length}:`); removed.slice(0, 15).forEach((x) => console.log('  ' + x)); }
if (SAVE) { writeFileSync(SNAP, JSON.stringify(now), 'utf8'); console.log('\n스냅샷 갱신됨.'); }
else console.log('\n(--no-save · 스냅샷 그대로)');
process.exit(0);
