/**
 * 엔카 작업 시트(차종·제원·배터리)를 구글에서 읽어 구조만 검수한다.
 * JSON·라이브 mf- 원장은 안 읽는다. 시트에 쓰지 않는다.
 *
 *   npx tsx scripts/audit-encar-work-sheet.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  ENCAR_BATTERY_TAB,
  ENCAR_MASTER_SHEET_ID,
  ENCAR_MASTER_TAB,
  ENCAR_MASTER_URL,
  ENCAR_NAME_COLUMNS,
  ENCAR_SPEC_TAB,
  loadEncarWorkSheetGrids,
} from '../lib/domain/encar-master-sheet';
import { selfCheckEncarMatch, workBookFromTabs, type NameRow } from '../lib/domain/encar-work-sheet-match';

const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com',
});
const api = async (url: string) => {
  const tok = (await jwt.getAccessToken()).token;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
  const body = await res.json() as Record<string, any>;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};

const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${ENCAR_MASTER_SHEET_ID}?fields=properties.title,sheets.properties(title,hidden,gridProperties)`);
const tabs = ((meta.sheets || []) as any[]).map((s) => S(s.properties?.title)).filter(Boolean);
const need = [ENCAR_MASTER_TAB, ENCAR_SPEC_TAB, ENCAR_BATTERY_TAB];
const missingTabs = need.filter((t) => !tabs.includes(t));

const grids = await loadEncarWorkSheetGrids(api);
const book = workBookFromTabs(grids);
const checks = selfCheckEncarMatch(book);

const ym = /^(?:\d{4}-\d{2}|현재|보류)$/;
const key5 = (r: NameRow) => [r.origin, r.maker, r.model, r.sub, r.trim].join('|');
const fold = (s: string) => s.replace(/\s+/g, '').toLowerCase();
const seen = new Map<string, number>();
const dups: string[] = [];
const missingReq: string[] = [];
const parens: string[] = [];
const kiaGen: string[] = [];
const emptyPeriod: string[] = [];
const holdPeriod: { sub: string; start: string; end: string; n: number }[] = [];
const holdMap = new Map<string, { sub: string; start: string; end: string; n: number }>();
const weirdPeriod: string[] = [];
const origins = new Map<string, number>();
const makers = new Map<string, number>();

for (const r of book.names) {
  const k = key5(r);
  seen.set(k, (seen.get(k) || 0) + 1);
  if (!r.origin || !r.maker || !r.model || !r.sub || !r.trim) {
    missingReq.push(`${r.maker} ${r.model} ${r.sub} ${r.trim || '(트림없음)'}`);
  }
  if (/[()（）]/.test([r.model, r.sub, r.trim].join(''))) {
    parens.push(`${r.maker} ${r.sub} ${r.trim}`);
  }
  if (r.maker === '기아' && /\d+\s*세대/.test(r.sub)) kiaGen.push(r.sub);
  origins.set(r.origin, (origins.get(r.origin) || 0) + 1);
  makers.set(r.maker, (makers.get(r.maker) || 0) + 1);
  if (!r.start || !r.end) emptyPeriod.push(`${r.maker} ${r.sub}`);
  else if (!ym.test(r.start) || !ym.test(r.end)) weirdPeriod.push(`${r.maker} ${r.sub} ${r.start}~${r.end}`);
  if (r.start === '보류' || r.end === '보류') {
    const hk = `${r.maker}|${r.sub}|${r.start}|${r.end}`;
    const cur = holdMap.get(hk) || { sub: `${r.maker} ${r.sub}`, start: r.start, end: r.end, n: 0 };
    cur.n += 1;
    holdMap.set(hk, cur);
  }
}
for (const [k, n] of seen) if (n > 1) dups.push(`${n}× ${k}`);
holdPeriod.push(...holdMap.values());
holdPeriod.sort((a, b) => a.sub.localeCompare(b.sub, 'ko'));

const g80dh = book.names.filter((r) => r.sub === 'G80 DH');
const g80plain = book.names.filter((r) => r.maker === '제네시스' && r.sub === 'G80');
const k5dl3 = book.names.filter((r) => r.sub === 'K5 DL3');
const gtLine = [...new Set(book.names.filter((r) => /GT[- ]Line/i.test(r.trim)).map((r) => r.trim))];
const latin = [...new Set(book.names.filter((r) => /N Line|X Line|H-PICK|GT Line|GT-Line/i.test(r.trim)).map((r) => `${r.maker} ${r.sub} ${r.trim}`))];

const subKeys = new Set(book.names.map((r) => `${r.maker}|${r.model}|${r.sub}`));
const batOrphan = book.batteries.filter((b) => !subKeys.has(`${b.maker}|${b.model}|${b.sub}`));
const hdrRow = (grid: unknown[][], ...need: string[]) => {
  const n = (s: string) => S(s).replace(/\s+/g, '');
  const want = need.map(n);
  const i = (grid || []).slice(0, 8).findIndex((r) => want.every((w) => (r || []).some((c) => n(String(c ?? '')) === w)));
  return i < 0 ? 0 : i;
};
const nameHdrAt = hdrRow(grids.names as unknown[][], '제조사', '세부모델', '세부트림');
const specHdrAt = hdrRow(grids.specs as unknown[][], '구분', '값');
const batHdrAt = hdrRow(grids.batteries as unknown[][], '제조사', '세부모델');
const batHdr = ((grids.batteries[batHdrAt] || []) as unknown[]).map(S);
const specHdr = ((grids.specs[specHdrAt] || []) as unknown[]).map(S);
const nameHdr = ((grids.names[nameHdrAt] || []) as unknown[]).map(S);
const batAllRows = ((grids.batteries || []) as unknown[][]).slice(batHdrAt + 1).filter((r) => S(r[0]));

const issues: string[] = [];
if (missingTabs.length) issues.push(`없는 탭: ${missingTabs.join(', ')}`);
if (checks.length) issues.push(`매처 자가검증 ${checks.length}건`);
if (missingReq.length) issues.push(`필수값 빈칸 ${missingReq.length}`);
if (dups.length) issues.push(`이름 중복 ${dups.length}`);
if (parens.length) issues.push(`괄호 ${parens.length}`);
if (kiaGen.length) issues.push(`기아 N세대 잔존 ${kiaGen.length}`);
if (emptyPeriod.length) issues.push(`생산기간 빈칸 ${emptyPeriod.length}`);
if (weirdPeriod.length) issues.push(`생산기간 형식 ${weirdPeriod.length}`);
if (!g80dh.length) issues.push('G80 DH 없음');
if (g80plain.length) issues.push(`제네시스 세부모델 G80(DH 아님) ${g80plain.length}행`);
if (!k5dl3.length) issues.push('K5 DL3 없음');
if (batOrphan.length) issues.push(`배터리 고아 세부모델 ${batOrphan.length}`);
if (book.fuels.size < 4) issues.push('제원 연료가 너무 적음');
{
  const missing = ENCAR_NAME_COLUMNS.filter((c) => !nameHdr.some((h) => h.replace(/\s+/g, '') === c.replace(/\s+/g, '')));
  if (missing.length) issues.push(`머리글 없음 ${missing.join(' · ')}`);
  const trimAt = nameHdr.findIndex((h) => h.replace(/\s+/g, '') === '세부트림');
  const startAt = nameHdr.findIndex((h) => h.replace(/\s+/g, '') === '생산시작');
  if (trimAt >= 0 && startAt >= 0 && startAt < trimAt) issues.push('생산시작이 세부트림보다 앞');
}

const report = {
  at: new Date().toISOString(),
  sheet: ENCAR_MASTER_URL,
  title: S(meta.properties?.title),
  tabs,
  headers: { 차종마스터: nameHdr, 제원마스터: specHdr, 전기차배터리마스터: batHdr },
  counts: {
    names: book.names.length,
    fuels: [...book.fuels],
    ccs: book.ccs.size,
    drives: [...book.drives],
    batteriesParsed: book.batteries.length,
    batteriesSheetRows: batAllRows.length,
  },
  origins: Object.fromEntries(origins),
  makers: Object.fromEntries([...makers.entries()].sort((a, b) => b[1] - a[1])),
  exceptions: { g80dh: g80dh.length, g80plain: g80plain.length, k5dl3: k5dl3.length, kiaGen, gtLine },
  latinSample: latin.slice(0, 20),
  holdPeriod,
  emptyPeriod: [...new Set(emptyPeriod)].slice(0, 40),
  missingReq: missingReq.slice(0, 40),
  dups: dups.slice(0, 20),
  parens: parens.slice(0, 20),
  weirdPeriod: weirdPeriod.slice(0, 20),
  batOrphan: batOrphan.slice(0, 20),
  selfCheck: checks,
  issues,
};

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/encar-work-sheet-audit.json', JSON.stringify(report, null, 2), 'utf8');

console.log(`시트  ${S(meta.properties?.title)}`);
console.log(`주소  ${ENCAR_MASTER_URL}`);
console.log(`탭    ${tabs.join(' · ')}`);
console.log(`헤더  ${nameHdr.join(' | ')}`);
console.log(`차종  ${book.names.length}행 · 제조사 ${makers.size} · 원산지 ${[...origins.keys()].join(',')}`);
console.log(`제원  연료 ${[...book.fuels].join(',')} · cc ${book.ccs.size} · 구동 ${[...book.drives].join(',')}`);
console.log(`배터리 시트 ${batAllRows.length}행 · 파싱 ${book.batteries.length}`);
console.log(`예외  G80 DH ${g80dh.length}행 · 제네시스 G80 ${g80plain.length}행 · K5 DL3 ${k5dl3.length}행`);
console.log(`트림  GT*Line 표기: ${gtLine.join(' · ') || '(없음)'}`);
console.log(`기간  빈칸 ${emptyPeriod.length} · 보류묶음 ${holdPeriod.length} (${holdPeriod.reduce((a, b) => a + b.n, 0)}행) · 형식오류 ${weirdPeriod.length}`);
console.log(`구조  필수빈칸 ${missingReq.length} · 중복 ${dups.length} · 괄호 ${parens.length} · 기아N세대 ${kiaGen.length} · 배터리고아 ${batOrphan.length}`);
console.log(`매처  ${checks.length ? `실패\n${checks.map((x) => '  ' + x).join('\n')}` : '자가검증 통과'}`);
if (holdPeriod.length) {
  console.log('\n보류 생산기간');
  for (const h of holdPeriod) console.log(`  ${h.sub}  ${h.start}~${h.end}  (${h.n}행)`);
}
console.log(`\n${issues.length ? '⛔ 이슈 ' + issues.join(' · ') : '■ 구조 확보 — 구글 시트 읽기·머리글·필수값·예외 둘 확인'}`);
console.log('저장 tmp/encar-work-sheet-audit.json  (이름 사전이 아님. fill은 시트를 직접 읽는다)');
