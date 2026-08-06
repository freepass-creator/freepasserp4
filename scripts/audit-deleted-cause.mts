/**
 * v4 에서 삭제 표시된 매물이 «왜» 지워졌나 — 흔적을 모은다. 읽기 전용.
 *
 * 되살리기 전에 이유를 알아야 한다. 이유 있는 삭제(중복 정리·부재차단·판매완료)까지
 * 되살리면 이중판매가 난다.
 *
 * 보는 것: 삭제 시각 분포 · 삭제 표식 필드 · 감사로그(v4/audit_logs) 대응 · 같은 차의 생존 형제 키
 *
 * npx tsx scripts/audit-deleted-cause.mts
 */
import { readFileSync } from 'node:fs';
import { priceList } from '../lib/domain/product';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const PLATE = /\d{2,3}[가-힣]\d{4}/;
const plateOf = (p: Rec, key: string) => {
  for (const src of [p?.car_number, key, p?.product_code]) {
    const m = S(src).replace(/\s/g, '').match(PLATE);
    if (m) return m[0];
  }
  return '';
};
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';
const sellable = (p: Rec) => S(p?.vehicle_status).replace(/\s/g, '') !== '출고불가' && priceList(p as any).length > 0;

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const [v4s, v3s] = await Promise.all([db.ref('v4/products').get(), db.ref('products').get()]);
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  const v3 = (v3s.val() || {}) as Record<string, Rec>;

  const v4ByPlate = new Map<string, { key: string; p: Rec }[]>();
  for (const [k, p] of Object.entries(v4)) {
    const pl = plateOf(p, k);
    if (pl) v4ByPlate.set(pl, [...(v4ByPlate.get(pl) || []), { key: k, p }]);
  }

  /** 대상 = v3 는 팔 수 있는데 v4 형제가 전부 죽은 차 */
  const targets: { plate: string; key: string; p: Rec }[] = [];
  for (const [k, p] of Object.entries(v3)) {
    if (dead(p) || !sellable(p)) continue;
    const pl = plateOf(p, k);
    if (!pl) continue;
    const hits = v4ByPlate.get(pl) || [];
    if (hits.length && hits.every(({ p: q }) => dead(q))) {
      for (const h of hits) targets.push({ plate: pl, key: h.key, p: h.p });
    }
  }

  console.log(`\n══ v4 에서 삭제 표시된 매물 ${targets.length}건 — 왜 지워졌나 ══\n`);

  // 삭제 표식 필드 분포
  const marks = new Map<string, number>();
  for (const t of targets) {
    const keys = Object.keys(t.p).filter((k) => /delet|removed|blocked|absent|sold/i.test(k));
    const sig = keys.length ? keys.sort().join(',') : '(표식 없음 — _deleted/status 뿐)';
    marks.set(sig, (marks.get(sig) || 0) + 1);
  }
  console.log('■ 삭제 관련 필드 조합');
  for (const [m, n] of [...marks].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}건  ${m}`);

  // 삭제 시각 분포
  const days = new Map<string, number>();
  for (const t of targets) {
    const ts = t.p.deletedAt || t.p.deleted_at || t.p.updatedAt || t.p._snap_at;
    const d = ts ? new Date(typeof ts === 'number' ? ts : String(ts)).toISOString().slice(0, 10) : '(시각 없음)';
    days.set(d, (days.get(d) || 0) + 1);
  }
  console.log('\n■ 마지막 갱신일 분포');
  for (const [d, n] of [...days].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 12)) console.log(`   ${String(n).padStart(4)}건  ${d}`);

  // source 분포
  const src = new Map<string, number>();
  for (const t of targets) src.set(S(t.p.source) || '(없음)', (src.get(S(t.p.source) || '(없음)') || 0) + 1);
  console.log('\n■ 유입 경로(source)');
  for (const [s, n] of [...src].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}건  ${s}`);

  // 키 규약
  const conv = new Map<string, number>();
  for (const t of targets) {
    const k = t.key.startsWith('EXT_') ? 'EXT_해시' : /^[A-Z]{2}\d+_|^PT-\d+_/.test(t.key) ? '공급사_차번' : /^\d{2,3}[가-힣]\d{4}/.test(t.key) ? '차번' : '기타';
    conv.set(k, (conv.get(k) || 0) + 1);
  }
  console.log('\n■ 키 규약');
  for (const [k, n] of [...conv].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}건  ${k}`);

  console.log('\n■ 표본 (전체 필드)');
  for (const t of targets.slice(0, 2)) {
    console.log(`   ── ${t.plate} · key ${t.key}`);
    for (const [f, v] of Object.entries(t.p).sort()) {
      const s = typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v);
      console.log(`      ${f.padEnd(26)} ${s.slice(0, 80)}`);
    }
    console.log('');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
