/**
 * **「대신 적기」가 정말로 문을 여는가** — 넣고 · 열리는지 보고 · 도로 지운다.
 *
 * ★사장님 2026-08-27 「erp화면에서 일단 계정없어도 그냥 우리가 메모하는거로 쓸거라니까」
 *   「영업채널 파트너사로만 만들어두면 돼」.
 *   관리자가 대신 적으면 그 채널이 막던 공급사 청구서가 나갈 수 있어야 한다.
 *
 * ★★**시험 기록은 반드시 지운다.** 정본에 남으면 다음 사람이 «진짜 확인»으로 읽는다 —
 *   그 상태로 청구서가 나가면 확인 안 받은 실적이 공급사에 나간 것이 된다.
 * ⚠ 이 검사는 «관문 계산»(providerBillGate)을 시험한다. HTTP 경로의 권한·근거 검사는
 *   `app/api/settlement/confirm/route.ts` 안에 있고 여기서는 안 지난다.
 *
 *   npx tsx scripts/check-confirm-proxy.mts [2026-08]
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { billingMonth, type SettlementRow } from '../lib/domain/settlement-stage';
import { normalizeRecord, type SettlementRecord } from '../lib/domain/settlement-record';
import { confirmKey, confirmLabel, providerBillGate, type Confirmation } from '../lib/domain/settlement-confirm';
import { nameKey } from '../lib/domain/settlement-view';

const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '2026-08').trim();
const S = (v: unknown) => String(v ?? '').trim();
const NODE = 'v4/settlement_confirmations';

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL });
const db = getDatabase();

/** 저장 기록 → 규칙이 먹는 줄. 정산서 뽑는 스크립트와 «같은 변환»이어야 한다. */
const D = (v: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(v)); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
const asRow = (r: SettlementRecord): SettlementRow => ({
  ...r, receivedAt: D(r.receivedAt), deliveredAt: D(r.deliveredAt), clawbackAt: D(r.clawbackAt),
} as unknown as SettlementRow);
const recs = Object.values((await db.ref('v4/settlement_rows').get()).val() || {})
  .map((r) => normalizeRecord(r as SettlementRecord));
const live = recs.filter((r) => !r.cancelled && billingMonth(asRow(r)) === MONTH);
const confs = (Object.values((await db.ref(NODE).get().catch(() => null))?.val() || {}) as Confirmation[])
  .filter((c) => S(c.month) === MONTH);

/** 공급사별로 관문을 세운다 — 정산서 뽑는 스크립트와 «같은 계산»이다. */
const suppliers = [...new Set(live.map((r) => S(r.supplier)).filter(Boolean))];
const gateOf = (cs: Confirmation[]) => suppliers.filter((sup) => providerBillGate(
  live.filter((r) => S(r.supplier) === sup).map((r) => ({ channel: r.channel, channelCode: r.channelCode, agent: r.agent })), cs,
).length > 0);

/** 코드 → 파트너사 정식 상호. 이름이 어긋나는 짝을 고르는 데 쓴다. */
const v4p = ((await db.ref('v4/partners').get()).val() || {}) as Record<string, Record<string, unknown>>;
const legalOf = (code: string) => {
  const p = v4p[code] || Object.values(v4p).find((x) => S(x.partner_code) === code) || {};
  return S(p.name) || S(p.partner_name) || S(p.company_name) || code;
};

const blockedBefore = gateOf(confs);
const channels = [...new Set(live.map((r) => S(r.channel)).filter(Boolean))];
console.log(`\n■ ${MONTH} — 청구 ${live.length}건 · 공급사 ${suppliers.length}곳 · 영업채널 ${channels.length}곳\n`);
console.log(`  대신 적기 전    막힌 공급사 ${blockedBefore.length}곳`);

/** 가장 많이 막는 채널 하나로 시험한다 — 열리는 폭이 커서 눈에 잘 보인다. */
const target = channels.map((c) => ({ c, n: live.filter((r) => S(r.channel) === c).length }))
  .sort((a, b) => b.n - a.n)[0];
if (!target) { console.log('\n  ⛔ 이 달에 영업채널이 없습니다 — 시험할 것이 없습니다.\n'); process.exit(1); }

const key = confirmKey(MONTH, target.c);
if (confs.some((c) => c.key === key)) {
  console.log(`\n  ⛔ 「${target.c}」 확인이 이미 있습니다 — 진짜 기록을 건드리지 않으려고 멈춥니다.\n`);
  process.exit(1);
}

const rec: Confirmation = {
  key, month: MONTH, who: target.c, role: 'agent', state: '확인',
  lines: target.n, disputed: [], note: '검사용 — 곧 지웁니다',
  at: Date.now(), by: 'check-confirm-proxy', proxy: true, proxyBy: '검사',
};

let bad = 0;
try {
  await db.ref(`${NODE}/${key}`).set(rec);
  const after = gateOf([...confs, rec]);
  const opened = blockedBefore.filter((s) => !after.includes(s));
  console.log(`  대신 적기       ○ ${target.c} ${target.n}건 · 「${confirmLabel(rec, target.n)}」`);
  console.log(`  연 공급사        ${opened.length ? `○ ${opened.length}곳 — ${opened.join(' · ')}` : '⛔ 한 곳도 안 열렸습니다'}`);
  if (!opened.length) bad++;
  if (!/대신 적음/.test(confirmLabel(rec, target.n))) { bad++; console.log('  ⛔ 「대신 적음」 표시가 안 붙습니다'); }

  const back = (await db.ref(`${NODE}/${key}`).get()).val() as Confirmation | null;
  if (!back?.proxy) { bad++; console.log('  되읽기          ⛔ proxy 표시가 안 남았습니다'); }
  else console.log(`  되읽기          ○ proxy · ${back.proxyBy} · ${back.note}`);
} finally {
  await db.ref(`${NODE}/${key}`).remove();
  const gone = (await db.ref(`${NODE}/${key}`).get()).val();
  if (gone) { bad++; console.log('  치우기          ⛔ 시험 기록이 안 지워졌습니다 — 손으로 지우세요'); }
  else console.log('  치우기          ○ 시험 기록 지움');
}

/**
 * ★★**코드로만 열리는 경우** — 사장님 2026-08-27 「원장과 코드로 해야지」.
 *
 * 원장 「SMC」 ↔ 파트너사 「에스엠씨(S.M.C)」 는 이름 규칙으로 «영원히 안 붙는다».
 * 그래서 상호를 그대로 적은 확인을 넣고, **코드가 없으면 안 열리고 코드가 있으면 열리는지**
 * 둘 다 본다. 하나만 보면 「원래 열리는 것 아니냐」를 못 가른다.
 */
const codeCh = [...new Set(live.map((r) => S(r.channel)).filter(Boolean))]
  .map((c) => ({ c, code: S(live.find((r) => S(r.channel) === c)?.channelCode), n: live.filter((r) => S(r.channel) === c).length }))
  // ★«이름 규칙으로 못 붙는» 짝만 고른다. 앞머리로 붙는 짝(하허호 ─ 하허호무심사)을 고르면
  //   코드 없이도 열려서 시험이 아무것도 안 가른다.
  .filter((x) => {
    const w = nameKey(x.c); const g = nameKey(legalOf(x.code));
    return !!x.code && !!w && !!g && !w.startsWith(g) && !g.startsWith(w);
  })
  .sort((a, b) => b.n - a.n)[0];

if (!codeCh) {
  console.log('  코드 시험        — 건너뜀 (이름이 어긋나는 채널이 이 달에 없습니다)');
} else {
  const legal = legalOf(codeCh.code);
  const ck = confirmKey(MONTH, `코드시험${codeCh.code}`);
  const base = {
    key: ck, month: MONTH, who: legal, role: 'agent' as const, state: '확인' as const,
    lines: codeCh.n, disputed: [], note: '검사용 — 곧 지웁니다',
    at: Date.now(), by: 'check-confirm-proxy', proxy: true, proxyBy: '검사',
  };
  /**
   * ★**«이 채널이 관문에 남아 있나»로 본다.** 「공급사가 열렸나」로 보면 안 된다 —
   *   한 공급사는 여러 채널이 막고 있어서, 한 곳을 풀어도 다른 곳이 계속 막는다.
   *   실측 2026-08: SMC 를 풀어도 손오공·우리캐피탈은 하허호가 계속 막는다.
   */
  const stuck = (cs: Confirmation[]) => providerBillGate(
    live.map((r) => ({ channel: r.channel, channelCode: r.channelCode, agent: r.agent })), cs,
  ).some((g) => g.channel === codeCh.c);
  // ① 코드 «없이» — 이름이 안 맞으니 그대로 막혀 있어야 한다
  const noCode = stuck([...confs, base as Confirmation]);
  // ② 코드 «있게» — 이름이 달라도 풀려야 한다
  const stillStuck = stuck([...confs, { ...base, whoCode: codeCh.code } as Confirmation]);
  console.log(`\n  코드 시험        「${codeCh.c}」 ↔ 「${legal}」 (${codeCh.code}) · ${codeCh.n}건`);
  console.log(`   코드 없으면      ${noCode ? '○ 그대로 막힙니다 (이름이 안 맞으니 당연)' : '⛔ 이름으로 열렸습니다 — 시험이 뜻이 없습니다'}`);
  if (!noCode) bad++;
  console.log(`   코드 있으면      ${stillStuck ? '⛔ 코드가 있는데도 안 풀립니다' : '○ 풀립니다 — 이름이 달라도 코드로 붙었습니다'}`);
  if (stillStuck) bad++;
}

const back2 = gateOf(confs);
console.log(`  도로 막히나      ${back2.length === blockedBefore.length ? '○' : '⛔'} ${back2.length}곳`);
if (back2.length !== blockedBefore.length) bad++;
console.log(bad ? `\n  ⛔ ${bad}가지가 틀렸습니다.\n` : '\n  ○ 대신 적으면 열리고, 지우면 도로 막힙니다.\n');
process.exit(bad ? 1 : 0);
