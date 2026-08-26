/**
 * **영업자·공급사가 보는 원장이 맞는가.** 읽기만 한다.
 *
 * 두 가지를 센다 —
 *   ① **금액이 안 실리는가** (`publicRowOf` 가 내보내는 칸·값)
 *   ② **이름이 맞물리는가** (원장의 공급사 상호 ↔ partners / 영업담당자 ↔ users)
 *
 * ★②가 이 스크립트의 진짜 이유다. 코드가 아무리 맞아도 원장에 「제일오토」라 적혀 있고
 *   partners 에 「제일오토렌탈(주)」로 들어 있으면 그 공급사는 **0줄만 본다.**
 *   그건 «권한이 잘 막힌 것»처럼 보여서 아무도 버그로 신고하지 않는다. 그래서 세어 둔다.
 *
 *   npx tsx scripts/verify-settlement-view.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import type { SettlementRow } from '../lib/domain/settlement-stage';
import { countsOf, nameKey, publicRowOf, scopeRows } from '../lib/domain/settlement-view';

const S = (v: unknown) => String(v ?? '').trim();
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";

// ─────────────────────────────────────────────── ① 금액이 안 실리는가
const sample: SettlementRow = {
  plate: '123가4567', supplier: '(주)제일오토렌탈', agent: '박영업', product: '선출고',
  term: 36, rent: 500_000, price: 33_000_000, deposit: 1_000_000, model: 'K5', customer: '홍길동',
  payKind: '2회분납', receivedAt: new Date(2026, 7, 1), deliveredAt: new Date(2026, 7, 10),
  clawbackAt: null, clawbackAmount: 0, paper: true, delivered: true, cancelled: false, clawback: false,
  claimWritten: 900_000, payWritten: 400_000, supplierRate: 0.03, agentRate: 0.02,
};
const pub = publicRowOf(sample);
const BAN_KEYS = ['claimWritten', 'payWritten', 'supplierRate', 'agentRate', 'price', 'clawbackAmount', 'money', 'phone'];
const leakedKeys = Object.keys(pub).filter((k) => BAN_KEYS.includes(k));
const body = JSON.stringify(pub);
const leakedVals = [900_000, 400_000, 33_000_000, 0.03, 0.02].filter((v) => body.includes(String(v)));

console.log('\n■ 금액이 밖으로 나가는가');
console.log(`   나가는 칸 ${Object.keys(pub).length}개 — ${Object.keys(pub).join(' · ')}`);
console.log(`   ${leakedKeys.length ? '⛔ 금지 칸 ' + leakedKeys.join(',') : '✓ 금지 칸 없다'}`);
console.log(`   ${leakedVals.length ? '⛔ 금액 값 ' + leakedVals.join(',') : '✓ 금액 값 없다'}`);

console.log('\n■ 내 것만 남는가 — 못 알아보면 «전부»가 아니라 «0줄»이어야 한다');
const two = [sample, { ...sample, plate: '999하9999', supplier: '다른렌트', agent: '김영업' }];
const cases: [string, number, number][] = [
  ['공급사 — (주) 붙어도 맞는가', scopeRows(two, { role: 'provider', supplier: '제일오토렌탈', agent: '' }).length, 1],
  ['영업자 — 자기 것만', scopeRows(two, { role: 'agent', supplier: '', agent: '박영업' }).length, 1],
  ['★이름을 못 찾으면 0줄', scopeRows(two, { role: 'provider', supplier: '', agent: '' }).length, 0],
  ['★남의 이름이면 0줄', scopeRows(two, { role: 'agent', supplier: '', agent: '없는사람' }).length, 0],
  ['관리자는 전부', scopeRows(two, { role: 'admin', supplier: '', agent: '' }).length, 2],
];
for (const [name, got, want] of cases) console.log(`   ${got === want ? '✓' : '⛔'} ${name} — ${got}줄 (기대 ${want})`);
console.log(`   실적 건수 : ${countsOf([pub]).map((c) => `${c.label} ${c.n}`).join(' · ')}`);

// ─────────────────────────────────────────────── ② 이름이 맞물리는가
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const tok = (await jwt.getAccessToken()).token;
const suppliers = new Map<string, number>();
const agents = new Map<string, number>();
for (const tab of ['접수', '취소', '분납실적', '완료실적']) {
  const u = `https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}`;
  const got = await (await fetch(u, { headers: { Authorization: `Bearer ${tok}` } })).json() as { values?: unknown[][] };
  const all = (got.values || []).map((r) => (r || []).map(S));
  const hi = all.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) continue;
  const h = all[hi];
  for (const r of all.slice(hi + 1)) {
    if (!S(r[h.indexOf('차량번호')])) continue;
    const sup = S(r[h.indexOf('공급사')]);
    const ag = S(r[h.indexOf('영업담당자')]);
    if (sup) suppliers.set(sup, (suppliers.get(sup) || 0) + 1);
    if (ag) agents.set(ag, (agents.get(ag) || 0) + 1);
  }
}

console.log(`\n■ 원장에 적힌 이름 — 공급사 ${suppliers.size}곳 · 영업담당자 ${agents.size}명`);

/** RTDB 를 서비스계정으로 읽는다(REST). 관리자 SDK 를 스크립트에 끌어오지 않기 위해서다. */
const dbUrl = S(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL);
if (!dbUrl) {
  console.log('   ⚠ NEXT_PUBLIC_FIREBASE_DATABASE_URL 이 없어 RTDB 대조는 건너뛴다.');
} else {
  const rtdbJwt = new JWT({
    email: sa.client_email, key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
  });
  const rt = (await rtdbJwt.getAccessToken()).token;
  const node = async (path: string) => {
    const r = await fetch(`${dbUrl}/${path}.json?shallow=false`, { headers: { Authorization: `Bearer ${rt}` } });
    return r.ok ? (await r.json() as Record<string, Record<string, unknown>> | null) : null;
  };
  const [partners, users] = await Promise.all([node('partners'), node('users')]);

  const pKeys = new Map<string, string>();
  for (const [code, p] of Object.entries(partners || {})) {
    const nm = S(p?.name || p?.partner_name || p?.company_name);
    if (nm) pKeys.set(nameKey(nm), `${code} ${nm}`);
  }
  const uKeys = new Map<string, string>();
  for (const [uid, u] of Object.entries(users || {})) {
    const nm = S(u?.name);
    if (nm) uKeys.set(nameKey(nm), `${uid.slice(0, 6)} ${nm}`);
  }

  const report = (title: string, ledger: Map<string, number>, reg: Map<string, string>, who: string, prefix: boolean) => {
    const keys = [...reg.keys()];
    // 공급사는 줄임말을 «유일할 때만» 푼다 — isSameCompany 와 같은 규칙으로 센다.
    const found = (n: string) => {
      const v = nameKey(n);
      if (reg.has(v)) return true;
      if (!prefix || v.length < 2) return false;
      return keys.filter((k) => k.startsWith(v)).length === 1;
    };
    const miss = [...ledger].filter(([n]) => !found(n)).sort((a, b) => b[1] - a[1]);
    const hit = ledger.size - miss.length;
    console.log(`\n   ${title} — ${reg.size}개 등록 / 원장 ${ledger.size}개 중 ${hit}개 맞물림`);
    if (miss.length) {
      const rows = miss.reduce((s, [, n]) => s + n, 0);
      console.log(`   ⚠ 못 맞춘 ${miss.length}개(${rows}줄) — 이 ${who}는 «0줄»만 본다`);
      for (const [n, c] of miss.slice(0, 15)) console.log(`      ${String(c).padStart(4)}줄  ${n}`);
      if (miss.length > 15) console.log(`      … 외 ${miss.length - 15}개`);
    }
  };
  report('공급사 ↔ partners', suppliers, pKeys, '공급사', true);
  report('영업담당자 ↔ users', agents, uKeys, '영업자', false);
}

const ok = leakedKeys.length === 0 && leakedVals.length === 0 && cases.every(([, g, w]) => g === w);
console.log(`\n${ok ? '■ 초록 — 금액은 안 나가고, 못 알아보면 닫힌다.' : '⛔ 빨강 — 고치기 전에는 역할용 화면을 열지 마라.'}\n`);
process.exit(ok ? 0 : 1);
