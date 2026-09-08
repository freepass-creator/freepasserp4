/**
 * **차종 인기순 — 「실제로 나간 것」으로 센다.** 읽기 전용 · 결과를 `public/data/model-popularity.json` 에 쓴다.
 *
 * ★왜(사장님 2026-09-08 「상품 많은 순은 별도고 인기순은 별도야」)
 *   ERP 정렬 `popular` 은 라벨이 「상품 많은 순」이고 셈도 **재고 대수**다. 그건 «우리가 많이 들고 있는 차»지
 *   «손님이 많이 찾는 차»가 아니다. 둘을 한 칸에 뭉쳐 두어서 「인기순」이 없는 채로 굴러왔다.
 *
 * ★**인기 = 계약 실적**이다. 정산원장 「접수」에 올라온 계약을 차번으로 세고, 그 차번의 «모델»을 원자에서 읽어
 *   모델별로 모은다. 판 만큼이 인기다 — 조회수·찜처럼 우리가 아직 안 재는 값으로 짐작하지 않는다.
 *
 * ⚠ **재고 대수를 섞지 않는다.** 섞으면 또 「상품 많은 순」이 된다.
 * ⚠ 실적이 없는 모델은 0이다 — 「없다」가 아니라 «아직 안 팔렸다»이고, 정렬에서는 뒤로 간다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/build-model-popularity.mts [--apply]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { SETTLEMENT_LEDGER_ID, SETTLEMENT_INTAKE_TAB, SETTLEMENT_DONE_TAB } from '../lib/domain/settlement-ledger';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const NKEY = (v: unknown) => S(v).replace(/\s/g, '');
const APPLY = process.argv.includes('--apply');
const OUT = 'public/data/model-popularity.json';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const api = async (u: string): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 5) { await new Promise((k) => setTimeout(k, 5000 * (n + 1))); continue; }
    throw new Error(`${r.status} ${t.slice(0, 160)}`);
  }
};

/** 차번 → 모델 (원자가 정본 — 원장에는 모델이 없다). */
const modelOf = new Map<string, string>();
for (const d of (await getFirestore().collection('products').get()).docs) {
  const v = d.data() as any;
  const car = NKEY(v.car_number); const m = S(v.model);
  if (car && m) modelOf.set(car, m);
}

/** 원장에서 계약이 선 차번을 모은다 — 접수 + 완납실적(지난 실적). */
const plates = new Set<string>();
let ledgerRows = 0;
for (const tab of [SETTLEMENT_INTAKE_TAB, SETTLEMENT_DONE_TAB]) {
  try {
    const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SETTLEMENT_LEDGER_ID}/values/${encodeURIComponent(`'${tab}'!A1:BZ5000`)}`);
    const rows: string[][] = (v.values || []).map((r: any[]) => r.map(S));
    /** 머리글은 1행이 아니라 «「차량번호」가 있는 줄»이다 — 1행엔 탭 설명이 붙는다. */
    const hAt = rows.findIndex((r) => r.some((c) => /^차량번호$/.test(NKEY(c))));
    if (hAt < 0) { console.warn(`  ${tab} — 차량번호 머리글 없음`); continue; }
    const pAt = rows[hAt].findIndex((c) => /^차량번호$/.test(NKEY(c)));
    for (const r of rows.slice(hAt + 1)) { const p = NKEY(r[pAt]); if (p) { plates.add(p); ledgerRows++; } }
    console.log(`  ${tab} — 계약 줄 ${rows.length - hAt - 1}`);
  } catch (e) { console.warn(`  ${tab} 실패:`, (e as Error).message); }
}

const count = new Map<string, number>();
let matched = 0;
for (const p of plates) {
  const m = modelOf.get(p);
  if (!m) continue;                        // 원자에 없는 차 — 옛 매물. 「모른다」라 안 센다
  count.set(m, (count.get(m) || 0) + 1); matched++;
}
const ranked = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
console.log(`\n원장 차번 ${plates.size} · 원자에서 모델을 찾은 것 ${matched} · 모델 ${ranked.length}가지`);
console.log(`상위 15: ${ranked.slice(0, 15).map(([m, n]) => `${m} ${n}`).join(' · ')}`);

const doc = {
  무엇: '차종 인기순 — 계약 실적(정산원장 접수·완납)으로 센다. 재고 대수가 아니다.',
  근거: `정산원장 ${SETTLEMENT_LEDGER_ID} 「${SETTLEMENT_INTAKE_TAB}」·「${SETTLEMENT_DONE_TAB}」`,
  잰날: new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 16).replace('T', ' '),
  계약차번: plates.size, 모델매칭: matched,
  순위: Object.fromEntries(ranked),
};
if (!APPLY) { console.log('\n※ dry-run — --apply 로 적는다.\n'); process.exit(0); }
writeFileSync(OUT, JSON.stringify(doc, null, 1), 'utf8');
console.log(`\n✓ ${OUT} 에 적었다 — 모델 ${ranked.length}가지`);
process.exit(0);
