/**
 * **운영정책 한 칸 고치기** — 정책코드로 줄을 찾아 지정한 칸 값을 바꾼다. 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-02 「손오공 **픽업 구독에 만 26세 이상 보험료 포함**이야, 구독이.」
 *   「손오공구독 픽업구독 **정책 다 동일해**.」
 *   → 손오공구독 87대 · 픽업구독 338대가 같은 `POL-0020` 을 쓰므로 **그 한 줄만 고치면 425대가 따라온다.**
 *
 * ⚠ 정책은 **시트가 정본**이다(`publish-origin-tab` 이 여기서 읽어 판매시트 정책 43열로 내보낸다).
 *   ERP 를 직접 고치지 않는다 — 다음 자동동기 회차가 시트를 읽어 반영한다.
 * ⚠ 표기는 `policy-value-spec` 규격을 따른다 — 같은 시트의 다른 줄이 쓰는 글자를 그대로 쓴다.
 *   (「보험료 포함」/「보험료 별도」처럼 값이 정해져 있다. 새 표현을 지어내면 드롭다운·조인이 깨진다.)
 *
 *   npx tsx scripts/set-policy-insurance.mts --code=POL-0020 --col=보험료 --value="보험료 포함"
 *   npx tsx scripts/set-policy-insurance.mts --code=POL-0020 --col=보험료 --value="보험료 포함" --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');

/** 손오공 프리패스 재고 시트(구독재고·픽업재고·운영정책이 한 문서에 있다). */
const SHEET = arg('sheet') || '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA';
const TAB = arg('tab') || '운영정책';
const CODE = arg('code');
/**
 * ★**정책명으로도 찾는다** — 2026-09-02 실측: 「만 21세 이상 구독」 줄은 **정책UID·정책코드가 비어 있다.**
 *   코드로만 찾으면 그런 줄은 영영 못 고친다. 코드가 있으면 코드로, 없으면 이름으로 짚는다.
 */
const NAME = arg('name');
const COL = arg('col');
const VALUE = arg('value');
if ((!CODE && !NAME) || !COL || !VALUE) { console.error('✗ (--code 또는 --name) · --col · --value 가 있어야 한다'); process.exit(1); }

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  const t = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const x = await r.text(); if (!r.ok) throw new Error(`${r.status} ${x.slice(0, 200)}`);
  return x ? JSON.parse(x) : {};
};

const v = await call(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(TAB)}`);
const rows = ((v.values || []) as string[][]);
if (!rows.length) { console.error(`✗ 「${TAB}」 탭이 비었다`); process.exit(1); }
const hdr = rows[0].map(norm);
const codeAt = hdr.findIndex((h) => /정책코드/.test(h));
const colAt = hdr.findIndex((h) => norm(h) === norm(COL));
const nameAt = hdr.findIndex((h) => /정책명/.test(h));
if (CODE && codeAt < 0) { console.error('✗ 「정책코드」 열을 못 찾았다'); process.exit(1); }
if (NAME && nameAt < 0) { console.error('✗ 「정책명」 열을 못 찾았다'); process.exit(1); }
if (colAt < 0) { console.error(`✗ 「${COL}」 열을 못 찾았다 — 있는 열: ${rows[0].join(' · ')}`); process.exit(1); }

const hits = rows
  .map((r, i) => ({ r, i }))
  .filter(({ r, i }) => i > 0 && (CODE ? norm(r[codeAt]) === norm(CODE) : norm(r[nameAt]) === norm(NAME)));
if (!hits.length) { console.error(`✗ ${CODE ? `정책코드 ${CODE}` : `정책명 「${NAME}」`} 인 줄이 없다`); process.exit(1); }
/** ⚠ 여러 줄이 걸리면 «어느 것»인지 사람이 정해야 한다. 임의로 첫 줄을 고르지 않는다. */
if (hits.length > 1) {
  console.error(`✗ ${hits.length}줄이 걸린다 — 어느 줄인지 정해야 한다:`);
  for (const h of hits) console.error(`   ${h.i + 1}행  ${h.r.slice(0, 5).join(' | ')}`);
  process.exit(1);
}
const at = hits[0].i;

const before = S(rows[at][colAt]);
const A1 = `${String.fromCharCode(65 + colAt)}${at + 1}`;   // 열 26개 이내 가정(운영정책 탭 규격)
console.log(`■ ${TAB} · ${CODE}${nameAt >= 0 ? ` (${S(rows[at][nameAt])})` : ''}`);
console.log(`   ${COL} 칸 ${A1}`);
console.log(`   지금  「${before || '(빈칸)'}」`);
console.log(`   바꿈  「${VALUE}」  ${APPLY ? '(반영)' : '(dry-run)'}`);
if (before === VALUE) { console.log('\n이미 그 값이다 — 아무것도 안 한다'); process.exit(0); }
if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply\n'); process.exit(0); }

await call(
  `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(`${TAB}!${A1}`)}?valueInputOption=USER_ENTERED`,
  { method: 'PUT', body: JSON.stringify({ values: [[VALUE]] }) },
);
const after = await call(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(`${TAB}!${A1}`)}`);
console.log(`\n■ 되읽기 — 「${S(((after.values || [])[0] || [])[0])}」`);
console.log('   ERP 반영은 다음 자동동기 회차가 한다(시트가 정본).');
