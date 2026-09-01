/**
 * **영업자에게 코드를 부여한다 — 동명이인을 가르려고.**
 *
 * ★사장님 2026-08-26 「영업채널 영업자명 이렇게 해야하고 그리고 각각 영업자한테 코드를
 *   부여해야할거 같어 / 동명이인 거르려면」.
 *
 *   실측 — 「이승호」가 렌트야와 임시소속에 하나씩, 「이하민」이 하허호에 둘,
 *   「정동근」이 개인영업채널과 바름카에 하나씩. 이름만으로는 누구 실적인지 못 정한다.
 *
 * ★코드는 **새로 만들지 않는다.** 회원에게 이미 있는 `user_code`(`usr_…`)를 쓴다 —
 *   ERP5 코드 규격(`docs/ERP5_CODE_SYSTEM.md`)이 그렇게 정해 뒀다. 여기서 또 만들면 코드가 둘이 된다.
 * ★★**애매하면 안 채운다.** 이름+채널로도 하나로 안 좁혀지면 빈칸으로 두고 이름을 보고한다.
 *   틀린 코드는 빈칸보다 나쁘다 — 빈칸은 눈에 띄지만 틀린 코드는 조용히 남의 실적이 된다.
 * ⚠ 사람이 이 칸을 타이핑하게 두지 않는다(코드 규격). 접수할 때 고르게 하고 기계가 채운다.
 *
 *   npx tsx scripts/assign-agent-codes.mts            세어만 본다
 *   npx tsx scripts/assign-agent-codes.mts --apply    칸을 내고 채운다
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { nameKey } from '../lib/domain/settlement-view';

const APPLY = process.argv.includes('--apply');
const TABS = ['접수', '취소', '분납실적', '완납실적'];
const COL = '영업자코드';
/**
 * ★사장님 2026-08-26 「일단 영업자는 관리자가 이름 연락처로 입력해서 정산할수 있게끔하고
 *   나중에 가입하면 매칭시켜주는거로」 — 계정이 없어도 정산이 돌아야 한다.
 *   그래서 «연락처» 칸을 같이 낸다. 나중에 그 사람이 가입하면 번호로 저절로 붙는다.
 * ⚠ PII 다. 원장은 도메인 전체가 읽으니 **역할용 API 로는 절대 안 내보낸다**(PublicRow 에 없다).
 */
const COL_PHONE = '영업자연락처';
const S = (v: unknown) => String(v ?? '').trim();
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const sheetJwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const call = async (u: string, init?: RequestInit) => {
  const t = (await sheetJwt.getAccessToken()).token;
  const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${t}`, 'content-type': 'application/json', ...(init?.headers || {}) } });
  const x = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${x.slice(0, 200)}`);
  return x ? JSON.parse(x) : {};
};

// ── 회원 명부
const dbUrl = S(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL);
if (!dbUrl) { console.log('⛔ NEXT_PUBLIC_FIREBASE_DATABASE_URL 이 없다'); process.exit(1); }
const rtdb = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] });
const rtok = (await rtdb.getAccessToken()).token;
type U = { name?: string; user_code?: string; company_name?: string; status?: string; is_active?: unknown; role?: string; phone?: string };
/** 전화번호는 표기가 제각각이다 — 01072954455 / 010-7295-4455. 숫자만 남겨 맞댄다. */
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const users = (await (await fetch(`${dbUrl}/users.json`, { headers: { Authorization: `Bearer ${rtok}` } })).json()) as Record<string, U>;

const live = Object.entries(users || {}).filter(([, u]) => {
  const st = S(u?.status);
  if (st === 'deleted' || st === 'rejected') return false;
  if (u?.is_active === false || S(u?.is_active) === '아니오') return false;
  return !!S(u?.name) && !!S(u?.user_code);
});
const byName = new Map<string, { uid: string; u: U }[]>();
for (const [uid, u] of live) {
  const k = nameKey(u.name);
  (byName.get(k) || byName.set(k, []).get(k)!).push({ uid, u });
}
console.log(`\n■ 회원 ${live.length}명 (코드 있는 활성 계정) · 이름 ${byName.size}가지`);

/** 이름 → 코드. **하나로 안 좁혀지면 안 준다.** */
function codeFor(agent: string, channel: string): { code: string; why: string; phone?: string } {
  const hits = byName.get(nameKey(agent)) || [];
  if (hits.length === 0) return { code: '', why: '계정 없음' };
  if (hits.length === 1) return { code: S(hits[0].u.user_code), why: '', phone: S(hits[0].u.phone) };
  /**
   * ★**같은 전화번호면 같은 사람이다.** 실측 2026-08-26 —
   *   이하민(S0002·S0032) · 정동근(U0123·U0125) · 신선호(U0031·U0127) 셋 다 번호가 같았다.
   *   중복 계정이 아니라 «같은 사람이 두 번 가입»한 것이라, 어느 코드를 박아도 그 사람이다.
   *   ⚠ 원장에는 **코드**를 박는다. 전화번호는 PII 라 시트에 퍼뜨리지 않고,
   *     번호는 바뀌지만 코드는 안 바뀐다(그게 코드 규격을 둔 이유다).
   *   같은 사람이면 **가장 오래된 코드**를 쓴다 — 골라야 할 때 흔들리지 않는 쪽으로.
   */
  const phoneSet = new Set(hits.map((h) => digits(h.u.phone)).filter((v) => v.length >= 9));
  if (phoneSet.size === 1 && hits.every((h) => digits(h.u.phone).length >= 9)) {
    const codes = hits.map((h) => S(h.u.user_code)).filter(Boolean).sort();
    if (codes.length) return { code: codes[0], why: '', phone: S(hits[0].u.phone) };
  }

  // 동명이인 — 소속으로 좁힌다
  const ch = nameKey(channel);
  if (!ch) return { code: '', why: `동명이인 ${hits.length}명인데 영업채널이 비어 있다` };
  const narrowed = hits.filter((h) => {
    const c = nameKey(h.u.company_name);
    return !!c && (c === ch || c.startsWith(ch) || ch.startsWith(c));
  });
  if (narrowed.length === 1) return { code: S(narrowed[0].u.user_code), why: '', phone: S(narrowed[0].u.phone) };
  if (narrowed.length === 0) return { code: '', why: `동명이인 ${hits.length}명인데 채널(${channel})과 맞는 소속이 없다` };
  // 같은 회사에 같은 이름 계정이 둘 — 사람이 정리해야 한다(중복 계정일 가능성)
  return { code: '', why: `${channel} 안에 같은 이름 계정이 ${narrowed.length}개 — 중복 계정으로 보인다` };
}

// ── 원장을 훑는다
let filled = 0; let already = 0; let blank = 0; let noAgent = 0; let phones = 0;
const stuck = new Map<string, { n: number; why: string; channels: Set<string> }>();
const writes: { range: string; values: string[][] }[] = [];
const addCol: { tab: string; sheetId: number; at: number }[] = [];

const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}?fields=sheets.properties`);
const sheetIdOf = new Map<string, number>(
  (meta.sheets as { properties: { title: string; sheetId: number } }[]).map((s) => [s.properties.title, s.properties.sheetId]),
);

for (const tab of TABS) {
  const got = await call(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}`);
  const all = ((got.values || []) as unknown[][]).map((r) => (r || []).map(S));
  const hi = all.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) { console.log(`   ⚠ ${tab} — 머리글을 못 찾았다`); continue; }
  const head = all[hi];
  let iCode = head.indexOf(COL);
  let iPhone = head.indexOf(COL_PHONE);
  let next = head.length;
  if (iCode < 0) {
    iCode = next++;
    addCol.push({ tab, sheetId: sheetIdOf.get(tab)!, at: iCode });
    writes.push({ range: `${a1(tab)}!${colA1(iCode)}${hi + 1}`, values: [[COL]] });
  }
  if (iPhone < 0) {
    iPhone = next++;
    addCol.push({ tab, sheetId: sheetIdOf.get(tab)!, at: iPhone });
    writes.push({ range: `${a1(tab)}!${colA1(iPhone)}${hi + 1}`, values: [[COL_PHONE]] });
  }
  const iAgent = head.indexOf('영업담당자');
  const iChan = head.indexOf('영업채널');
  const iPlate = head.indexOf('차량번호');

  for (let i = hi + 1; i < all.length; i++) {
    const r = all[i];
    if (!S(r[iPlate])) continue;
    const agent = S(r[iAgent]);
    if (!agent) { noAgent++; continue; }
    const { code, why, phone } = codeFor(agent, S(r[iChan]));
    // ★연락처는 코드와 «따로» 채운다. 코드가 이미 있는 줄도 번호는 비어 있다 —
    //   코드 채우기를 먼저 끝냈기 때문이다. 여기서 continue 하면 번호가 영영 안 들어간다(실측).
    if (phone && !S(r[iPhone])) {
      writes.push({ range: `${a1(tab)}!${colA1(iPhone)}${i + 1}`, values: [[phone]] });
      phones++;
    }
    if (S(r[iCode])) { already++; continue; }
    if (!code) {
      blank++;
      const c = stuck.get(agent) || { n: 0, why, channels: new Set<string>() };
      c.n += 1; c.channels.add(S(r[iChan]) || '(채널 비어 있음)');
      stuck.set(agent, c);
      continue;
    }
    filled++;
    writes.push({ range: `${a1(tab)}!${colA1(iCode)}${i + 1}`, values: [[code]] });
  }
}

console.log(`\n■ 원장 — 코드를 채울 수 있는 줄 ${filled} · 이미 있는 줄 ${already} · 못 채우는 줄 ${blank} · 영업담당자 없는 줄 ${noAgent}`);
console.log(`   연락처를 채울 수 있는 줄 ${phones} — 계정이 없어도 이 번호로 나중에 붙는다`);
if (stuck.size) {
  console.log(`\n■ 못 채운 이름 ${stuck.size}가지 — **빈칸으로 둔다.** 틀린 코드는 빈칸보다 나쁘다`);
  for (const [name, v] of [...stuck].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`   ${String(v.n).padStart(4)}줄  ${name.padEnd(10)} ${v.why}`);
    console.log(`          채널 ${[...v.channels].join(' · ')}`);
  }
}

if (!APPLY) {
  console.log(`\n   아무것도 안 썼다. 넣으려면 --apply\n`);
  process.exit(0);
}

// ① 칸 먼저 낸다 — 값보다 머리글이 먼저다
if (addCol.length) {
  await call(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: addCol.map((c) => ({
        appendDimension: { sheetId: c.sheetId, dimension: 'COLUMNS', length: 1 },
      })),
    }),
  });
  console.log(`   ✓ 칸을 냈다 — ${addCol.map((c) => c.tab).join(' · ')}`);
}

// ② 값 — 한 번에 너무 많이 보내면 거절당한다. 끊어 보낸다.
for (let i = 0; i < writes.length; i += 400) {
  const chunk = writes.slice(i, i + 400);
  await call(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values:batchUpdate`, {
    method: 'POST',
    // ★RAW — `usr_k7m…` 를 구글이 해석하게 두지 않는다.
    body: JSON.stringify({ valueInputOption: 'RAW', data: chunk }),
  });
  console.log(`   ✓ ${Math.min(i + 400, writes.length)}/${writes.length}`);
}
console.log(`\n■ 넣었다 — ${filled}줄에 코드가 박혔다.\n`);
