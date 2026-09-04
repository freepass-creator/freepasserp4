/**
 * **상대가 시트에서 고친 칸을 «보고, 원장을 고칠지 정한다».**
 *
 * ★★★사장님 2026-09-04 「덮지말고 그거를 우리가 보고 우리 원장을 변경할지 검토해야하는거야」
 *
 * ```
 * npx tsx scripts/review-sheet-edits.mts                       대기 중인 것 보기
 * npx tsx scripts/review-sheet-edits.mts --받음=<번호> --왜="..."   원장에 반영
 * npx tsx scripts/review-sheet-edits.mts --물림=<번호> --왜="..."   안 쓰기로
 * npx tsx scripts/review-sheet-edits.mts --받음=1,3,4 --왜="..."   여럿 한 번에
 * ```
 *
 * ★**받을 수 있는 칸은 «사실»뿐이다.** 인도일·임차인·모델명처럼 원장에 그대로 들어가는 것만
 *   자동으로 옮긴다. 돈(공급가액·부가세·합계)·수수료 산정 기준·지급 예정일은 «계산에서 나오는 값»이라
 *   여기서 못 바꾼다 — 그건 요율표나 정산 줄을 고쳐야 하는 일이고, 사람이 판단할 몫이다.
 *
 * ★고쳐도 «이미 나간 종이»는 안 바뀐다. 돈이 달라지는 고침이면 다시 뽑아야 한다 —
 *   그래서 돈 칸은 자동으로 안 받는다.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { editId, type SheetEdit, type EditStatus } from '../lib/server/sheet-edits';

const S = (v: unknown) => String(v ?? '').trim();
const arg = (n: string) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : ''; };
const TAKE = arg('받음'); const DROP = arg('물림'); const WHY = arg('왜');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();

/**
 * **시트 칸 ↔ 원장 밭.** 여기 없는 칸은 «계산에서 나오는 값»이라 자동으로 못 받는다.
 * ⚠ 밭 이름을 바꿀 때는 `publish-channel-settlement` 의 `lineOf` 와 «같이» 본다.
 */
const FIELD: Record<string, string> = {
  차량번호: 'plate', 접수일: 'receivedAt', 인도일: 'deliveredAt', 공급사: 'supplier', 모델명: 'model',
  '차량 가격(신차)': 'price', 임차인: 'customer', 영업사: 'agent', '상품 구분': 'product',
  '계약 기간': 'term', 렌탈료: 'rent', 보증금: 'deposit', '납입 방식': 'payKind',
};
const NUMFIELD = new Set(['price', 'term', 'rent', 'deposit']);

const raw = (await db.ref('v4/sheet_edits').get()).val() || {};
const all = Object.values(raw) as SheetEdit[];
const idOf = (e: SheetEdit) => editId(e.channel, e.month, e.key, e.column);
const pend = all.filter((e) => S(e.status) === '대기')
  .sort((a, b) => `${a.channel}${a.month}${a.key}${a.column}`.localeCompare(`${b.channel}${b.month}${b.key}${b.column}`));

if (!TAKE && !DROP) {
  const done = all.filter((e) => S(e.status) !== '대기');
  console.log(`\n■ 시트에서 고친 칸 — 검토 대기 ${pend.length}개 (끝난 것 ${done.length}개)\n`);
  if (!pend.length) console.log('   없습니다.\n');
  pend.forEach((e, i) => {
    const can = FIELD[e.column] ? '' : '   ※ 계산값이라 자동으로 못 받습니다';
    console.log(`  ${String(i + 1).padStart(2)}. ${S(e.channel).padEnd(8)} ${e.month}  ${S(e.key).padEnd(10)} 「${e.column}」`);
    console.log(`      우리 원장 ${(S(e.ours) || '(빈칸)').padEnd(16)} →  그쪽이 적음 ${S(e.theirs) || '(빈칸)'}${can}`);
    if (S(e.why)) console.log(`      ${S(e.why)}`);
  });
  console.log('\n   받으려면 — npx tsx scripts/review-sheet-edits.mts --받음=1 --왜="확인함"\n');
  process.exit(0);
}

if (!WHY) { console.log('\n  ✕ --왜="..." 로 «왜 그렇게 정했는지»를 남겨 주세요.\n'); process.exit(1); }
const pick = (S(TAKE) || S(DROP)).split(',').map((x) => Number(x.trim())).filter((n) => n >= 1 && n <= pend.length);
if (!pick.length) { console.log(`\n  ✕ 번호를 못 읽었습니다 (1~${pend.length})\n`); process.exit(1); }
const status: EditStatus = TAKE ? '받음' : '물림';

/** 원장에서 그 줄을 찾는다 — 차량번호로. 여러 줄이면 손대지 않는다(어느 줄인지 알 수 없다). */
const rowsRaw = (await db.ref('v4/settlement_rows').get()).val() || {};
const rows = Object.entries(rowsRaw) as [string, Record<string, unknown>][];
const plateOf = (v: unknown) => S(v).replace(/\s+/g, '');

let ok = 0; let skipped = 0;
for (const n of pick) {
  const e = pend[n - 1];
  const id = idOf(e);
  if (status === '물림') {
    await db.ref(`v4/sheet_edits/${id}`).update({ status, why: WHY });
    console.log(`  물림  ${e.channel} ${e.month} ${e.key} 「${e.column}」`);
    ok++; continue;
  }
  const field = FIELD[e.column];
  if (!field) { console.log(`  ✕ ${e.key} 「${e.column}」 — 계산값이라 자동으로 못 받습니다. 정산 줄이나 요율표를 고쳐 주세요.`); skipped++; continue; }
  const hits = rows.filter(([, r]) => plateOf(r.plate) === plateOf(e.key)
    && S(r.channel).includes(S(e.channel).slice(0, 3)) && r.cancelled !== true);
  if (hits.length !== 1) { console.log(`  ✕ ${e.key} — 원장에서 줄을 «하나»로 못 찾았습니다(${hits.length}줄)`); skipped++; continue; }
  const [code] = hits[0];
  const val: string | number = NUMFIELD.has(field) ? Number(S(e.theirs).replace(/[,\s원개월]/g, '')) || 0 : S(e.theirs);
  await db.ref(`v4/settlement_rows/${code}`).update({ [field]: val, updatedAt: new Date().toISOString() });
  await db.ref(`v4/sheet_edits/${id}`).update({ status, why: WHY });
  console.log(`  받음  ${e.channel} ${e.month} ${e.key} 「${e.column}」  ${S(e.ours) || '(빈칸)'} → ${S(e.theirs)}   (원장 ${code}.${field})`);
  ok++;
}
console.log(`\n  ✓ ${ok}개 처리${skipped ? ` · ${skipped}개 손 못 댐` : ''}`);
console.log('  ※ 원장을 고쳤으면 그 달 탭을 다시 찍어야 시트에도 반영됩니다.\n');
process.exit(0);
