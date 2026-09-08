/**
 * **접수에 차번만 넣으면 나머지를 «원자»에서 당겨 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★★★사장님 2026-09-08
 *   「강팀장이 우리 정산시트에 접수를 하면 **그때부터 파이어스토어에서 원자 땡겨가자**」
 *   「그리고 그 원자들을 **각 시트에 뿌려주는 구조**로 가야지 안 틀릴 거 같아」
 *   「원자로 땡길 때 **이미 어느 시트에 각각 어떤 내용으로 뿌릴지가 결정**되는 거지」
 *
 * ★★**틀림은 «손으로 두 번 적는 자리»에서 난다.**
 * ```
 * 여태   접수 탭에 차번·공급사·모델명·대여료·보증금·차량가액을 «사람이 다 적었다»
 *        → 재고에 있는 값과 갈리면 청구서·정산서가 통째로 틀린다
 * 이제   차번 하나만 적으면 나머지는 원자가 낸다 — 적는 자리가 하나로 준다
 * ```
 *
 * ★★★**뿌릴 곳은 원자가 이미 안다.** 따로 정하지 않는다.
 * ```
 * 원자의 공급사   →  그 공급사 재고 시트의 「YY년MM월 정산」 탭   (청구 축)
 * 원자의 영업채널  →  그 채널 정산 시트의 같은 탭                (지급 축)
 * 어떤 칸을 보이나 →  SETTLE_COLUMNS 의 hide — 한 곳에서 가른다
 * ```
 *   그래서 여기서 하는 일은 «채우는 것»뿐이고, 라우팅은 손댈 게 없다.
 *
 * ⚠ **빈칸만 채운다.** 사람이 적어 둔 값은 안 덮는다 — 협의로 달라진 대여료가 있다.
 * ⚠ **차가 원자에 없으면 넘어간다.** 지어내지 않는다.
 * ⚠ 대여료·보증금은 원자의 `price` 표에서 «계약기간 + 약정주행»으로 고른다.
 *   주행이 안 적혀 있으면 2만km 로 본다(그 상품의 기본).
 *
 * ```
 * npx tsx scripts/fill-intake-from-atoms.mts
 * npx tsx scripts/fill-intake-from-atoms.mts --apply
 * npx tsx scripts/fill-intake-from-atoms.mts --차=46소3910 --apply
 * ```
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { PARTNER_CI } from '../lib/domain/partner-ci';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원km]/gi, '')); return Number.isFinite(n) ? n : 0; };
const P = (v: unknown) => S(v).replace(/\s/g, '');
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const arg = (n: string) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : ''; };
const ONLY = P(arg('차'));
const APPLY = process.argv.includes('--apply');
const F04 = '1BjGBqAjRLEb9ZMKarpQsMF-q_UjdgmEqBAl1uVk8SR4';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const fs = getFirestore();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;
const api = async (m: string, b?: unknown) => {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${F04}${m}`, { method: b ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  if (!r.ok) { console.log(`\n  ✕ ${r.status} — ${(await r.text()).slice(0, 180)}\n`); process.exit(1); }
  return r.json() as Promise<{ values?: unknown[][] }>;
};
const A1 = (n: number) => { let s = ''; for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
/** 공급사코드(RP012) → 우리가 부르는 별칭(손오공). 모르면 코드를 그대로 둔다. */
const supplierOf = (code: string) => S(PARTNER_CI.find((c) => S(c.code) === S(code))?.alias) || S(code);

/**
 * 원자의 `price` 표에서 그 계약의 대여료·보증금을 고른다.
 * 키는 「개월_주행」 꼴 — `12_2만` · `36_3만`. 주행이 없으면 2만km 를 본다.
 */
type Money = { rent: number; deposit: number; key: string };
const pickPrice = (price: unknown, term: number, km: string): Money | null => {
  const t = price as Record<string, { rent?: unknown; deposit?: unknown }> | undefined;
  if (!t || typeof t !== 'object') return null;
  const want = [`${term}_${km || '2만'}`, `${term}_2만`, `${term}_3만`];
  for (const k of want) { const v = t[k]; if (v && N(v.rent)) return { rent: N(v.rent), deposit: N(v.deposit), key: k }; }
  return null;
};

const g = (await api(`/values/${encodeURIComponent("'접수'!A1:BB900")}?valueRenderOption=UNFORMATTED_VALUE`)).values || [];
const h0 = g.findIndex((r) => (r || []).some((c) => S(c) === '차량번호'));
if (h0 < 0) { console.log('\n  ✕ 「접수」 탭에서 머리줄을 못 찾았습니다\n'); process.exit(1); }
const h = (g[h0] || []).map(S); const ix = (n: string) => h.indexOf(n);

console.log(`\n■ 접수 탭 — 차번으로 원자를 당겨 «빈칸만» 채운다 ${APPLY ? '(반영)' : '(대조만)'}\n`);
const puts: { range: string; values: (string | number)[][] }[] = [];
let touched = 0; let noAtom = 0; let full = 0;
for (let i = h0 + 1; i < g.length; i++) {
  const r = g[i] || []; const plate = P(r[ix('차량번호')]);
  if (!plate || (ONLY && plate !== ONLY)) continue;
  const doc = await fs.collection('products').doc(plate).get();
  if (!doc.exists) { noAtom++; if (ONLY) console.log(`  ✕ ${plate} — 원자에 없습니다`); continue; }
  const a = doc.data() as Record<string, unknown>;
  const term = N(r[ix('계약기간')]);
  const money = pickPrice(a.price, term, '');
  /** 채울 후보 — 「칸 이름 → 원자에서 온 값」. 빈칸일 때만 쓴다. */
  const from: [string, string | number][] = [
    ['공급사', supplierOf(S(a.partner_code) || S(a.provider_company_code))],
    ['모델명', [S(a.model), S(a.trim_name)].filter(Boolean).join(' ') || S(a.sub_model)],
    ['렌탈료', money?.rent || 0],
    ['보증금', money?.deposit || 0],
  ];
  const did: string[] = [];
  for (const [name, val] of from) {
    const c = ix(name); if (c < 0 || !val) continue;
    if (S(r[c])) continue;                       // ★있는 값은 안 덮는다
    puts.push({ range: `'접수'!${A1(c)}${i + 1}`, values: [[val]] });
    did.push(`${name}=${typeof val === 'number' ? won(val) : val}`);
  }
  if (!did.length) { full++; continue; }
  touched++;
  console.log(`  + ${pad(plate, 10)} ${pad(S(r[ix('고객명')]), 8)} ${i + 1}행  ${did.join(' · ')}${money ? `   〈요금표 ${money.key}〉` : ''}`);
}
console.log(`\n   채울 줄 ${touched} · 이미 다 찬 줄 ${full} · 원자에 없는 차 ${noAtom} · 고칠 칸 ${puts.length}`);
console.log('   ※ 뿌릴 곳은 원자가 이미 압니다 — 공급사는 그 재고 시트로, 영업채널은 그 정산 시트로.');
if (!puts.length) { console.log('\n  채울 것이 없습니다.\n'); process.exit(0); }
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼습니다. --apply 로 채웁니다.\n'); process.exit(0); }
await api('/values:batchUpdate', { valueInputOption: 'RAW', data: puts });
console.log(`\n  ✓ ${puts.length}칸을 채웠습니다.`);
console.log('  ※ 이어서 — npm run settlement:import -- --apply 로 원자에 올리고, 발행기가 각 시트에 뿌립니다.\n');
process.exit(0);
