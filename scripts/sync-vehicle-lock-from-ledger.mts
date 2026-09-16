/**
 * **정산원장 「접수」에 올라온 차를 «계약중»으로, 「취소」로 간 차는 원천 상태로 되돌린다.**
 * 원자(ERP5 Firestore `products`)에 «직접» 쓴다. 기본 미리보기, 반영은 `--apply`.
 *
 * ★사장님 2026-09-16
 *   「정산원장에 차량번호가 접수에 들어온다는건 계약중으로 바뀐다는거지,
 *    그러다가 공급사 원천시트에서 불가가 되거나 삭제되면 출고불가 되는거고
 *    … 실제 상품에서도 빠질거거든 시트든 홈페이지든」
 *   · 취소로 간 차 → 「락 풀고 원천 상태로 복귀」(같은 날 확인)
 *   · 쓰는 자리 → 「원자(Firestore)에 직접」(같은 날 확인)
 *
 * ★★**판정은 내가 하지 않는다 — `resolveStatus` 한 곳이 한다.**
 *   이 도구가 하는 일은 «락을 걸고 푸는 것»뿐이고, 그 락으로 상태가 무엇이 되는지는 판정기가 정한다:
 *   ```
 *   락 있음 + 현 상태가 출고불가 아님  →  계약중(선점)   목록에 «보인다»
 *   락 있음 + 현 상태가 출고불가       →  출고불가(계약완료)  목록에서 내린다
 *   락 없음                            →  공급사 원천 상태 그대로
 *   ```
 *   그래서 「접수 → 계약중」과 「원천 이탈 → 출고불가」가 저절로 맞물린다 —
 *   원천에서 빠진 차는 `ingest-supplier-to-firestore --retire` 가 출고불가로 세우고(2026-09-16 규칙),
 *   그 순간 같은 락이 「계약선점」에서 「계약완료」로 뜻이 바뀐다.
 *
 * ★**원장 라이프사이클과 맞물리는 자리**(`lib/domain/settlement-ledger.ts` 규격):
 *   ```
 *   접수        인도 전 계약이 계속 쌓인다(청구월 없음)   → 계약중
 *   (인도완료)  청구월이 박히고 실적 탭으로 넘어간다        → 원천에서도 빠져 출고불가(계약완료)
 *   취소        계약 불가                                  → 락 해제 · 원천 상태로 복귀
 *   ```
 *
 * ⚠ **원장이 «정본»이다 — 이 도구는 원장을 고치지 않는다.** 읽기만 하고 원자에만 쓴다.
 *   (원장 칸을 채우는 것은 사람과 시트 수식의 몫이다.)
 * ⚠ 접수·취소 **양쪽에 다 있는 차번은 접수가 이긴다** — 취소됐다가 다시 접수된 차다.
 *   원장 키가 「차량번호 + 접수일」이라 같은 차가 다시 나갈 수 있다(settlement-ledger 머리말).
 * ⚠ 원자에 없는 차번은 **건너뛴다**(우리 재고가 아닌 차 · 이미 사라진 차). 세어서 알린다.
 *
 *   node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs --require ./scripts/lib/server-only-shim.cjs scripts/sync-vehicle-lock-from-ledger.mts
 *   node --env-file=.env.local ./node_modules/tsx/dist/cli.mjs --require ./scripts/lib/server-only-shim.cjs scripts/sync-vehicle-lock-from-ledger.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { resolveStatus } from '../lib/domain/atom-status';
import { erp5InventoryAppOptions } from '../lib/server/erp5-inventory-service-account';
import {
  SETTLEMENT_LEDGER_ID, SETTLEMENT_INTAKE_TAB, SETTLEMENT_CANCEL_TAB,
} from '../lib/domain/settlement-ledger';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
/** 차번 비교 키 — 공백만 지운다(원장은 사람이 적어 「133 하 4556」처럼 띄어 적기도 한다). */
const key = (v: unknown) => S(v).replace(/\s+/g, '');
/** 원자 문서키 — `ingest-supplier-to-firestore` 와 «같은 규칙»이어야 같은 문서를 연다. */
const docId = (car: string) => car.replace(/\s/g, '').replace(/[/#.$[\]]/g, '_');

/* ── 정산원장 읽기 ─────────────────────────────────────────────── */
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_SHEETS_APPLICATION_CREDENTIALS), 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  // ⚠ readonly 스코프는 도메인 위임 허용 목록에 없다(실측 401 unauthorized_client) — 다른 도구와 같은 스코프를 쓴다.
  //   권한이 넓어도 이 도구는 시트에 «쓰지 않는다»(values.get 만 부른다).
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com',
});
const sheetApi = async (url: string): Promise<any> => {
  const token = (await jwt.getAccessToken()).token;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};

/**
 * 한 탭의 「차량번호」 칸을 읽는다.
 * ★머리글은 1행이 아니다 — 원장 접수·취소 탭은 **1행이 안내문, 2행이 머리글**이다(실측 2026-09-16).
 *   행 번호를 박지 않고 「차량번호」가 있는 줄을 찾는다 — 안내문이 한 줄 늘어도 안 깨지게.
 */
async function platesOf(tab: string): Promise<{ plates: Set<string>; rows: number }> {
  const range = `'${tab.replace(/'/g, "''")}'!A1:AD2000`;
  const got = await sheetApi(`https://sheets.googleapis.com/v4/spreadsheets/${SETTLEMENT_LEDGER_ID}/values/${encodeURIComponent(range)}`);
  const rows: string[][] = ((got.values || []) as string[][]).map((r) => r.map(S));
  const head = rows.findIndex((r) => r.some((c) => c === '차량번호'));
  if (head < 0) throw new Error(`「${tab}」 탭에서 「차량번호」 머리글을 못 찾았다 — 원장 규격이 바뀌었는지 본다.`);
  const col = rows[head].indexOf('차량번호');
  const plates = new Set<string>();
  for (const r of rows.slice(head + 1)) { const k = key(r[col]); if (k) plates.add(k); }
  return { plates, rows: rows.length - head - 1 };
}

const 접수 = await platesOf(SETTLEMENT_INTAKE_TAB);
const 취소 = await platesOf(SETTLEMENT_CANCEL_TAB);
/** ★접수가 이긴다 — 취소됐다가 다시 접수된 차(같은 차가 다시 나간다). */
const 풀대상 = new Set([...취소.plates].filter((p) => !접수.plates.has(p)));
console.log(`■ 정산원장 — 접수 ${접수.plates.size}대 · 취소 ${취소.plates.size}대(접수에 다시 오른 차 뺀 ${풀대상.size}대가 해제 대상)`);

/* ── 원자와 대조 ───────────────────────────────────────────────── */
initializeApp(erp5InventoryAppOptions());
const fs = getFirestore();
const snap = await fs.collection('products').get();
/** 차번 → 문서. 원자는 차번이 정본 키다(같은 차가 두 줄이면 나중 것이 남는다 — ingest 와 같은 셈). */
const byPlate = new Map<string, { id: string; v: Record<string, unknown> }>();
for (const d of snap.docs) {
  const v = d.data() as Record<string, unknown>;
  const k = key(v.car_number);
  if (k) byPlate.set(k, { id: d.id, v });
}
console.log(`  원자 ${snap.size}대 읽음`);

type Plan = { plate: string; id: string; why: string; patch: Record<string, unknown> };
const 걸기: Plan[] = [];
const 풀기: Plan[] = [];
const 원자없음: string[] = [];

/** 락 값 = 원장에서 왔다는 표시. 계약 엔티티가 없어도 «누가 걸었는지»가 남아야 푸는 쪽이 헷갈리지 않는다. */
const LEDGER_LOCK = 'LEDGER';

for (const plate of 접수.plates) {
  const hit = byPlate.get(plate);
  if (!hit) { 원자없음.push(plate); continue; }
  const { id, v } = hit;
  if (S(v.locked_by_contract)) continue;          // 이미 걸려 있다 — 계약 코드가 있으면 그쪽이 정본이라 안 덮는다
  const st = resolveStatus({ base: S(v.vehicle_status) || S(v.status), raw: v.status_label_raw, locked: LEDGER_LOCK });
  걸기.push({
    plate, id,
    why: `${S(v.vehicle_status) || '(빈값)'} → ${st.vehicle_status}(${st.status_reason})`,
    patch: { ...st, locked_by_contract: LEDGER_LOCK, _ledger_lock_at: Date.now() },
  });
}

for (const plate of 풀대상) {
  const hit = byPlate.get(plate);
  if (!hit) { 원자없음.push(plate); continue; }
  const { id, v } = hit;
  /** ★원장이 건 락만 푼다 — 계약 엔티티(vehicle-claim)가 건 락은 그쪽이 주인이라 손대지 않는다. */
  if (S(v.locked_by_contract) !== LEDGER_LOCK) continue;
  /**
   * 락을 풀면 «공급사 원천 상태»로 돌아간다. 원천 표기(status_label_raw)가 정본이고,
   * 그게 없으면 지금 상태를 그대로 둔다 — 여기서 상태를 지어내지 않는다.
   */
  const base = S(v.status_label_raw) || S(v.vehicle_status) || S(v.status);
  const st = resolveStatus({ base, raw: v.status_label_raw, locked: '' });
  풀기.push({
    plate, id,
    why: `${S(v.vehicle_status) || '(빈값)'} → ${st.vehicle_status}(${st.status_reason}) · 취소`,
    patch: { ...st, locked_by_contract: '', _ledger_lock_at: Date.now() },
  });
}

const 보기 = (xs: Plan[]) => xs.slice(0, 8).map((x) => `${x.plate} ${x.why}`).join('\n      ');
console.log(`\n  계약중으로 걸 차 ${걸기.length}대${걸기.length ? `\n      ${보기(걸기)}${걸기.length > 8 ? `\n      … 그 밖 ${걸기.length - 8}대` : ''}` : ''}`);
console.log(`  락 풀 차 ${풀기.length}대${풀기.length ? `\n      ${보기(풀기)}${풀기.length > 8 ? `\n      … 그 밖 ${풀기.length - 8}대` : ''}` : ''}`);
if (원자없음.length) console.log(`  ⚠ 원자에 없는 차번 ${원자없음.length}대 — 우리 재고가 아니거나 이미 사라진 차: ${원자없음.slice(0, 6).join(' · ')}`);

if (!걸기.length && !풀기.length) { console.log('\n✓ 원장과 원자가 이미 같다 — 바꿀 것 없음.'); process.exit(0); }
if (!APPLY) { console.log('\n미리보기 — 반영하려면 --apply'); process.exit(0); }

let n = 0;
for (const 묶음 of [걸기, 풀기]) {
  for (let i = 0; i < 묶음.length; i += 400) {
    const batch = fs.batch();
    for (const p of 묶음.slice(i, i + 400)) { batch.set(fs.collection('products').doc(p.id), p.patch, { merge: true }); n++; }
    await batch.commit();
  }
}
console.log(`\n반영 완료 — 원자 ${n}대(걸기 ${걸기.length} · 풀기 ${풀기.length}).`);
console.log('  ※ 시트·홈페이지까지 가려면 판매시트를 다시 발행한다(F01·F86 은 원자를 읽는다).');
process.exit(0);
