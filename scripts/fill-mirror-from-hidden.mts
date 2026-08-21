/**
 * **우리 정제시트에 «이미 있는» 차의 빈 칸을 원본 어디서든 찾아 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-21 「차량번호 우리 정제시트에 있는 거만 제대로 채워줘」.
 *   숨긴 탭의 차를 **새로 들이지는 않는다**(옛 사본·판매완료가 재고로 되살아난다).
 *   다만 이미 우리 시트에 있는 차라면, 그 차의 값이 원본 숨긴 탭에만 남아 있어도 가져와 채운다.
 *
 * ★채우는 규칙 — **빈 칸만**. 이미 값이 있으면 손대지 않는다(공급사·우리가 고쳐 둔 값을 덮지 않는다).
 *   예외 하나: **차명이 «모델 이름 한 마디»뿐인데** 원본에 더 자세한 차명이 있으면 그것으로 올린다
 *   (오플 「EV6」 → 「EV6 롱 레인지 2WD 에어」). 짧은 쪽이 긴 쪽에 통째로 들어 있을 때만.
 * ⚠ 원본에서 **여러 탭이 서로 다른 값**을 주면 안 채운다 — 어느 쪽이 맞는지 우리가 모른다.
 *
 *   npx tsx scripts/fill-mirror-from-hidden.mts
 *   npx tsx scripts/fill-mirror-from-hidden.mts --apply
 *   npx tsx scripts/fill-mirror-from-hidden.mts --code=RP023 --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';
import { splitMakerModel } from '../lib/domain/mirror-sheet-mapping';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--code=')) || '').slice(7);
const PLATE = /^\d{2,3}[가-힣]\d{4}$/;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(20_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 140)}`);
  }
};
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };

/** 원본 열 이름 → 우리 정제시트 열 이름. 「정제시트 안내」 대응표 그대로. */
const MAP: [string, string[]][] = [
  ['차명(세부모델+트림)', ['모델명']],
  ['외부색상', ['색상']],
  ['연료', ['연료']],
  ['최초등록일', ['최초등록일', '최초등록']],
  ['주행거리', ['예상주행거리', '주행거리', '주행거리(예상)']],
  ['옵션', ['옵션']],
];

type Fix = { 공급사: string; 탭: string; 줄: number; 차번: string; 열: string; 전: string; 후: string; 출처: string };
const fixes: Fix[] = [];

for (const src of MIRROR_SOURCES) {
  if (ONLY && src.code !== ONLY) continue;
  if (src.kind !== 'sheet' || !src.from || !src.to) continue;

  // ── 원본 전 탭(숨김 포함) → 차번별 값. 값이 갈리면 «모름»으로 둔다.
  const grid = await call(`https://sheets.googleapis.com/v4/spreadsheets/${src.from}?includeGridData=true&fields=${encodeURIComponent('sheets(properties(sheetId,title,hidden),data(rowData(values(formattedValue))))')}`);
  const from = new Map<string, { vals: Map<string, string>; tabs: Set<string> }>();
  const conflict = new Set<string>();
  for (const sheet of ((grid.sheets || []) as Rec[])) {
    const title = S(sheet.properties?.title);
    const rows = ((sheet.data?.[0]?.rowData || []) as Rec[]).map((r) => ((r.values || []) as Rec[]).map((c) => S(c.formattedValue)));
    const hi = rows.findIndex((r) => r.some((c) => norm(c) === '차량번호')); if (hi < 0) continue;
    const hdr = rows[hi].map(norm); const pi = hdr.indexOf('차량번호');
    for (const r of rows.slice(hi + 1)) {
      const plate = norm(r[pi]); if (!PLATE.test(plate)) continue;
      const cur = from.get(plate) || { vals: new Map<string, string>(), tabs: new Set<string>() };
      cur.tabs.add(title);
      for (const [ours, cands] of MAP) {
        const at = cands.map((c) => hdr.indexOf(norm(c))).find((i) => i >= 0) ?? -1;
        const v = at >= 0 ? S(r[at]) : '';
        if (!v) continue;
        const had = cur.vals.get(ours);
        if (had && norm(had) !== norm(v)) { conflict.add(`${plate}|${ours}`); continue; }
        cur.vals.set(ours, v);
      }
      // 차종 → 모델명(제조사 말·연료 꼬리 뗀 이름)
      const ci = hdr.indexOf('차종');
      if (ci >= 0 && S(r[ci])) {
        const { model, maker } = splitMakerModel(S(r[ci]));
        if (model) { const had = cur.vals.get('모델명'); if (!had || norm(had) === norm(model)) cur.vals.set('모델명', model); else conflict.add(`${plate}|모델명`); }
        if (maker) cur.vals.set('제조사', maker);
      }
      from.set(plate, cur);
    }
  }

  // ── 우리 정제시트를 훑어 «빈 칸»만 채운다
  const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${src.to}?fields=sheets.properties(sheetId,title,hidden)`);
  const data: { range: string; values: string[][] }[] = [];
  let cars = 0;
  for (const p of ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec)) {
    const title = S(p.title); if (p.hidden || !/재고/.test(title) || /상품시트/.test(title)) continue;
    const rows = (((await call(`https://sheets.googleapis.com/v4/spreadsheets/${src.to}/values/${encodeURIComponent(`${title}!A1:BZ700`)}`)).values || []) as string[][]);
    const hi = rows.findIndex((r) => r.some((c) => norm(c) === '차량번호')); if (hi < 0) continue;
    const hdr = rows[hi].map(norm); const pi = hdr.indexOf('차량번호');
    rows.slice(hi + 1).forEach((r, k) => {
      const plate = norm(r[pi]); if (!PLATE.test(plate)) return;
      const f = from.get(plate); if (!f) return;
      cars++;
      const rowAt = hi + 2 + k;
      for (const [ours] of [...MAP, ['모델명'] as [string], ['제조사'] as [string]]) {
        const at = hdr.indexOf(norm(ours)); if (at < 0) continue;
        if (conflict.has(`${plate}|${ours}`)) continue;
        const now = S(r[at]); const want = S(f.vals.get(ours)); if (!want) continue;
        /**
         * 빈 칸이면 채운다. 값이 있으면 두되, **차명만** 예외 —
         * 지금 값이 원본 값 «안에 통째로 들어 있으면» 더 자세한 원본으로 올린다(「EV6」→「EV6 롱 레인지 2WD 에어」).
         */
        const thinName = ours === '차명(세부모델+트림)' && now && norm(want).includes(norm(now)) && norm(want) !== norm(now);
        if (now && !thinName) continue;
        data.push({ range: `'${title.replace(/'/g, "''")}'!${colA1(at)}${rowAt}`, values: [[want]] });
        fixes.push({ 공급사: src.name, 탭: title, 줄: rowAt, 차번: plate, 열: ours, 전: now || '(빈칸)', 후: want, 출처: [...f.tabs].join('·').slice(0, 40) });
      }
    });
  }
  console.log(`■ ${src.name}(${src.code}) — 우리 시트 ${cars}대 중 채울 칸 ${data.length}개`);
  if (APPLY && data.length) {
    for (let i = 0; i < data.length; i += 200) {
      await call(`https://sheets.googleapis.com/v4/spreadsheets/${src.to}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: data.slice(i, i + 200) }) });
    }
    console.log(`   ✓ 반영 ${data.length}칸`);
  }
}

const byCol = new Map<string, Fix[]>();
for (const f of fixes) (byCol.get(f.열) || byCol.set(f.열, []).get(f.열)!).push(f);
console.log(`\n■ 합계 ${fixes.length}칸 ${APPLY ? '(반영됨)' : '(dry-run)'}`);
for (const [col, list] of [...byCol].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n── ${col} ${list.length}칸`);
  for (const f of list.slice(0, 6)) console.log(`   ${f.공급사.padEnd(6)} ${f.차번.padEnd(10)} 「${f.전.slice(0, 22)}」 → 「${f.후.slice(0, 34)}」`);
  if (list.length > 6) console.log(`   … 그 밖 ${list.length - 6}칸`);
}
writeFileSync('tmp/fill-mirror-from-hidden.json', JSON.stringify(fixes, null, 2));
if (!APPLY) console.log('\n※ dry-run. 반영은 --apply · 목록 tmp/fill-mirror-from-hidden.json\n');
