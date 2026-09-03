/**
 * **손오공 재고시트의 「원산지」 빈 칸을 제조사로 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜 — 원산지는 **표시값이 아니라 «돈»**이다. 보증금 배율(국산 ×2 · 수입 ×3)의 근거라
 *   비면 보증금 계산이 막히고 **요금이 통째로 사라진다**(`sheet-import.ts:67` · 2026-08-28 오플 실사고).
 *
 * ⚠ **손오공은 `fill-supplier-ai-columns` 를 안 탄다**(⓪ 손오공 정제가 정본이라 스킵한다).
 *   그런데 ⓪ 는 차종마스터에서 이름만 복사할 뿐 원산지를 채우지 않는다 —
 *   그래서 **아무도 안 채우는 칸**이 됐다. 실측 2026-09-02: 손오공구독 72대 중 원산지 24%.
 *
 * ★값은 제조사로 정한다 — `isImportBrand`(SSOT). 여기서 브랜드 목록을 새로 쓰지 않는다.
 *   규칙이 두 벌이 되면 같은 차가 시트마다 국산/수입이 갈린다.
 * ★**빈 칸만 채운다.** 사람이 적어 둔 값은 안 덮는다(정말 바꾸려면 `--overwrite`).
 *
 *   npx tsx scripts/fill-sonokong-origin.mts
 *   npx tsx scripts/fill-sonokong-origin.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isImportBrand } from '../lib/domain/vehicle-origin';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const OVERWRITE = process.argv.includes('--overwrite');
const SHEET = '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA';   // 손오공 프리패스 재고
const TABS = ['구독재고', '픽업재고', '렌트재고'];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  const t = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const x = await r.text(); if (!r.ok) throw new Error(`${r.status} ${x.slice(0, 200)}`);
  return x ? JSON.parse(x) : {};
};
/** 열 번호 → A1 열 이름(AA 이상도 된다 — 재고시트는 54칸이라 Z 를 넘는다). */
const col = (i: number): string => {
  let n = i + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

let 총빈칸 = 0; let 총채움 = 0;
for (const tab of TABS) {
  let v: Rec;
  try { v = await call(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(tab)}`); }
  catch (e) { console.log(`■ ${tab} — 못 읽음: ${(e as Error).message.slice(0, 80)}`); continue; }
  const rows = ((v.values || []) as string[][]);
  if (!rows.length) { console.log(`■ ${tab} — 비었다`); continue; }
  const hdr = rows[0].map(norm);
  const pi = hdr.findIndex((h) => /차량?번호|차번/.test(h));
  const mi = hdr.findIndex((h) => /^제조사$/.test(h));
  const oi = hdr.findIndex((h) => /^(원산지|국산수입)$/.test(h));
  if (pi < 0 || mi < 0 || oi < 0) {
    console.log(`■ ${tab} — 열 없음(차번 ${pi} · 제조사 ${mi} · 원산지 ${oi})`);
    continue;
  }
  const updates: { range: string; values: string[][] }[] = [];
  const 예: string[] = [];
  let 빈칸 = 0;
  for (let r = 1; r < rows.length; r++) {
    const plate = norm(rows[r][pi]); if (!/\d{2,3}[가-힣]\d{4}/.test(plate)) continue;
    const cur = S(rows[r][oi]);
    if (cur && cur !== '-' && !OVERWRITE) continue;
    const maker = S(rows[r][mi]); if (!maker) continue;   // 제조사가 없으면 정할 근거가 없다 — 비운 채로 둔다
    빈칸 += 1;
    const val = isImportBrand(maker) ? '수입' : '국산';
    updates.push({ range: `'${tab}'!${col(oi)}${r + 1}`, values: [[val]] });
    if (예.length < 4) 예.push(`${plate} ${maker} → ${val}`);
  }
  총빈칸 += 빈칸;
  console.log(`■ ${tab}  차 ${rows.length - 1}줄 · 원산지 빈 칸 ${빈칸}개 ${APPLY ? '(반영)' : '(dry-run)'}`);
  for (const e of 예) console.log(`     ${e}`);
  if (!APPLY || !updates.length) continue;
  /** 한 번에 보낸다 — 칸마다 부르면 요청한도에 걸린다. */
  await call(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: updates }),
  });
  총채움 += updates.length;
  console.log(`     ✓ ${updates.length}칸 반영`);
}
console.log(`\n${APPLY ? `끝 — ${총채움}칸 채웠다` : `※ dry-run — 채울 칸 ${총빈칸}개. 반영은 --apply`}`);
console.log('   ERP·판매시트 반영은 다음 자동동기 회차가 한다(시트가 정본).');
