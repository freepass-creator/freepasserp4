/**
 * **ERP 접수 입력이 «실제로» 되는지** — 넣어 보고, 되읽고, 지운다.
 *
 * ★화면·API 가 있다고 «된다»가 아니다. 한 줄을 정말 넣어 봐야 안다.
 *   2026-08-27 실측 — 432 → 433 → 432. 넣히고 읽히고 지워진다.
 *
 * ⚠ **시험 줄은 반드시 지운다.** 정본에 시험 데이터가 남으면 다음 사람이 진짜인 줄 안다.
 *   차번은 `00시험0000` — 실물과 겹칠 수 없는 모양이다.
 *
 * ⚠ 이건 «저장소»를 시험한다. 화면의 접수 폼은 `POST /api/settlement/ledger` 로
 *   이 함수를 부른다 — 그 사이(권한·검증)는 여기서 안 본다.
 *
 *   NEXT_PUBLIC_FIREBASE_DATABASE_URL=... GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json  *     npx tsx scripts/check-intake-roundtrip.mts
 */
import { getDatabase } from 'firebase-admin/database';
import { firebaseAdminApp } from '../lib/server/firebase-admin';
import { appendIntake, listRows } from '../lib/server/settlement-erp-store';

const PLATE = '00시험0000';
const S = (v: unknown) => String(v ?? '').trim();
const before = (await listRows()).length;
console.log('\n■ ERP 접수 입력 시험\n');
console.log('  넣기 전 줄 수  ' + before);

const out = await appendIntake({
  plate: PLATE, model: '시험차', supplier: '손오공', channel: '하허호', agent: '이태헌',
  customer: '시험고객', product: '장기렌트', term: '48', rent: '500000',
} as never);
console.log('  넣기            ' + (out.ok ? `○ ${out.plate} · 접수일 ${out.receivedAt}` : `⛔ ${(out as { reason?: string }).reason}`));
if (!out.ok) process.exit(1);

// ★listRows 는 {row, tab, extra} 를 내놓는다 — 칸은 r.row 안에 있다.
const rows = await listRows();
const mine = rows.filter((r) => S((r.row as unknown as Record<string, unknown>).plate) === PLATE);
const one = mine[0] ? (mine[0].row as unknown as Record<string, unknown>) : null;
console.log('  되읽기          ' + (one
  ? `○ 찾음 · 공급사 ${S(one.supplier)} · 영업자 ${S(one.agent)} · 고객 ${S(one.customer)} · ${mine[0].tab}`
  : '⛔ 못 찾음'));
console.log('  줄 수 늘었나    ' + (rows.length === before + 1 ? `○ ${before} → ${rows.length}` : `⛔ ${before} → ${rows.length}`));

// ★시험 줄은 «반드시» 지운다. 정본에 시험 데이터가 남으면 다음 사람이 진짜인 줄 안다.
const db = getDatabase(firebaseAdminApp());
const all = (await db.ref('v4/settlement_rows').get()).val() || {};
let gone = 0;
for (const [k, v] of Object.entries(all as Record<string, Record<string, unknown>>)) {
  if (S(v.plate) === PLATE) { await db.ref(`v4/settlement_rows/${k}`).remove(); gone++; }
}
const after = (await listRows()).length;
console.log('  치우기          ' + (gone && after === before ? `○ ${gone}줄 지움 · ${after}줄로 되돌림` : `⛔ ${gone}줄 지웠는데 ${after}줄`));
console.log('');
process.exit(0);
