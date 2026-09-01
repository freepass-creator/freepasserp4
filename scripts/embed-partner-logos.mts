/**
 * 회원사 로고를 **종이 안에 박는다** — `assets/partner-logo/` → `lib/domain/partner-logo.ts`.
 *
 * ★왜 파일을 읽지 않고 «박나»
 *   정산서는 메일로 나가고 상대 컴퓨터에서 열린다. 바깥 주소를 걸면 그때 그림이 안 뜬다.
 *   그래서 data URI 로 종이 안에 넣는다 — 파일 하나면 끝난다.
 *
 * ★없는 로고는 «없는 채로» 둔다. 깨진 그림 상자가 뜨느니 상호 글자만 반듯한 게 낫다.
 *
 *   npx tsx scripts/embed-partner-logos.mts
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, basename, join } from 'node:path';
import { ciOf } from '../lib/domain/partner-ci';

const DIR = 'assets/partner-logo';
const OUT = 'lib/domain/partner-logo.ts';
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const KEY = (v: string) => v.trim().toLowerCase().replace(/\s+/g, '');
const kb = (n: number) => (n / 1024).toFixed(0) + 'KB';

if (!existsSync(DIR)) { console.log(`\n${DIR} 폴더가 없습니다.\n`); process.exit(0); }

const files = readdirSync(DIR).filter((f) => MIME[extname(f).toLowerCase()]);
console.log(`\n■ 회원사 로고 — ${files.length}장\n`);

const rows: string[] = [];
let heavy = 0;
for (const f of files.sort()) {
  const alias = basename(f, extname(f));
  const buf = readFileSync(join(DIR, f));
  const uri = `data:${MIME[extname(f).toLowerCase()]};base64,${buf.toString('base64')}`;
  // ★별칭이 거래처 정본에 없으면 종이에서 못 찾는다 — 조용히 지나가지 않는다.
  const known = !!ciOf(alias);
  console.log(`  ${known ? '○' : '⛔'} ${alias.padEnd(12)} ${kb(buf.length).padStart(6)}${known ? '' : '   ← 거래처 정본에 없는 별칭입니다'}`);
  if (buf.length > 100 * 1024) { heavy++; }
  rows.push(`  ${JSON.stringify(KEY(alias))}: ${JSON.stringify(uri)},`);
}
if (heavy) console.log(`\n  ⚠ ${heavy}장이 100KB 를 넘습니다 — 종이 파일이 그만큼 무거워집니다.`);

const head = readFileSync(OUT, 'utf8').split('export const PARTNER_LOGO')[0];
writeFileSync(OUT, `${head}export const PARTNER_LOGO: Record<string, string> = {
${rows.length ? rows.join('\n') : '  // 아직 없다 — assets/partner-logo/ 에 파일을 두고 이 스크립트를 돌린다'}
};

export const logoOf = (alias: unknown): string => PARTNER_LOGO[KEY(alias)] ?? '';
`, 'utf8');

console.log(`\n○ ${OUT} 다시 썼습니다.`);
console.log('  다음  npx tsx scripts/issue-settlement-invoices.mts 2026-08\n');
