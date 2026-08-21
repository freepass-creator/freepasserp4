/**
 * **원본의 숨긴 탭·숨긴 행까지 다 읽으면 차가 몇 대나 더 있나** — 읽기 전용.
 *
 * ★사장님 2026-08-21 「일단 출고불가 하더라도 숨겨놓은 것도 다시 다 갖고와봐」.
 *   평소 규칙은 **숨긴 탭·숨긴 행은 없는 것**이다(공급사가 안 쓰는 표를 지우지 않고 숨긴다 —
 *   오플 10탭 중 7개가 그랬다). 그래서 정제시트에는 안 들어온다.
 *   이 도구는 그 규칙을 잠깐 걷고 «가려져 있던 차»가 무엇인지만 보여 준다. 쓰지는 않는다.
 *
 * ⚠ 여기서 나온 차를 그대로 재고로 올리면 **옛 사본·프로모션 잔재가 되살아난다.**
 *   가져오기로 정하면 상태는 「출고불가」로 넣고, 파는 차인지는 공급사에 확인한다.
 *
 *   npx tsx scripts/audit-mirror-hidden.mts
 *   npx tsx scripts/audit-mirror-hidden.mts --code=RP023
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const ONLY = (process.argv.find((a) => a.startsWith('--code=')) || '').slice(7);
const PLATE = /^\d{2,3}[가-힣]\d{4}$/;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const call = async (u: string): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
    const x = await r.text();
    if (r.ok) return JSON.parse(x);
    if (r.status === 429 && n < 5) { await sleep(20_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 120)}`);
  }
};
/** 격자로 받아 «숨긴 행»까지 그대로 본다(rowMetadata 로 숨김 여부만 표시). */
const gridOf = async (id: string) => call(`https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent('sheets(properties(sheetId,title,hidden),data(rowMetadata(hiddenByFilter,hiddenByUser),rowData(values(formattedValue))))')}`);

type Found = { 공급사: string; 탭: string; 탭숨김: boolean; 줄: number; 행숨김: boolean; 차번: string; 차종: string; 모델명: string; 상태: string };
const all: Found[] = [];
for (const src of MIRROR_SOURCES) {
  if (ONLY && src.code !== ONLY) continue;
  if (src.kind !== 'sheet' || !src.from || !src.to) { console.log(`■ ${src.name}(${src.code}) — 원본이 시트가 아니다(홈페이지)`); continue; }
  // 우리 정제시트에 이미 있는 차번
  const ours = new Set<string>();
  const om = await call(`https://sheets.googleapis.com/v4/spreadsheets/${src.to}?fields=sheets.properties(title,hidden)`);
  for (const p of ((om.sheets || []) as Rec[]).map((s) => s.properties as Rec)) {
    const t = S(p.title); if (p.hidden || !/재고/.test(t) || /상품시트/.test(t)) continue;
    const rows = (((await call(`https://sheets.googleapis.com/v4/spreadsheets/${src.to}/values/${encodeURIComponent(`${t}!A1:B700`)}`)).values || []) as string[][]);
    for (const r of rows) for (const c of r) { const q = norm(c); if (PLATE.test(q)) ours.add(q); }
  }
  // 원본 전 탭(숨김 포함) · 전 행(숨김 포함)
  const grid = await gridOf(src.from);
  const found: Found[] = [];
  for (const sheet of ((grid.sheets || []) as Rec[])) {
    const title = S(sheet.properties?.title);
    const tabHidden = sheet.properties?.hidden === true;
    const meta = (sheet.data?.[0]?.rowMetadata || []) as Rec[];
    const rowData = (sheet.data?.[0]?.rowData || []) as Rec[];
    const rows = rowData.map((r) => ((r.values || []) as Rec[]).map((c) => S(c.formattedValue)));
    const hi = rows.findIndex((r) => r.some((c) => norm(c) === '차량번호'));
    const hdr = hi >= 0 ? rows[hi].map(norm) : [];
    const pi = hi >= 0 ? hdr.indexOf('차량번호') : -1;
    const ci = hi >= 0 ? hdr.indexOf('차종') : -1;
    const mi = hi >= 0 ? hdr.indexOf('모델명') : -1;
    const si = hi >= 0 ? hdr.findIndex((h) => /판매상태|상태/.test(h)) : -1;
    rows.forEach((r, k) => {
      if (hi >= 0 && k <= hi) return;
      const plate = pi >= 0 ? norm(r[pi]) : (r.map(norm).find((c) => PLATE.test(c)) || '');
      if (!PLATE.test(plate) || ours.has(plate)) return;
      const rowHidden = meta[k]?.hiddenByUser === true || meta[k]?.hiddenByFilter === true;
      found.push({ 공급사: src.name, 탭: title, 탭숨김: tabHidden, 줄: k + 1, 행숨김: rowHidden, 차번: plate, 차종: ci >= 0 ? S(r[ci]) : '', 모델명: mi >= 0 ? S(r[mi]) : '', 상태: si >= 0 ? S(r[si]) : '' });
    });
  }
  const uniq = new Map<string, Found>();
  for (const f of found) if (!uniq.has(f.차번)) uniq.set(f.차번, f);
  all.push(...uniq.values());
  console.log(`\n■ ${src.name}(${src.code}) — 정제시트에 없는 차 ${uniq.size}대`);
  const byTab = new Map<string, Found[]>();
  for (const f of uniq.values()) { const k = `${f.탭}${f.탭숨김 ? '(숨긴탭)' : ''}`; (byTab.get(k) || byTab.set(k, []).get(k)!).push(f); }
  for (const [t, list] of [...byTab].sort((a, b) => b[1].length - a[1].length)) {
    const hiddenRows = list.filter((x) => x.행숨김).length;
    console.log(`   ${String(list.length).padStart(3)}대  ${t.slice(0, 44)}${hiddenRows ? ` · 그중 숨긴 행 ${hiddenRows}` : ''}`);
    for (const f of list.slice(0, 3)) console.log(`        ${f.차번.padEnd(10)} 차종「${f.차종.slice(0, 16)}」 모델명「${f.모델명.slice(0, 26)}」 상태「${f.상태}」`);
  }
}
writeFileSync('tmp/mirror-hidden.json', JSON.stringify(all, null, 2));
console.log(`\n■ 합계 — 가려져 있던 차 ${all.length}대 · 목록 tmp/mirror-hidden.json`);
