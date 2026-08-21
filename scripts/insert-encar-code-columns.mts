/**
 * **재고 탭 — 정책코드 다음에 행키 셋을 둔다.** 기본 dry-run, 반영은 `--apply`.
 *
 *   모델행키 | 세부모델행키 | 세부트림행키 | 원산지 … 차종구분 | 차종코드 | 선택옵션 | 외장색상 | 내장색상 | 차종분류
 * ★예전 차종트림코드는 세부트림행키로 이름만 바꾼다(T 값 유지).
 * ★마스터표기·차종마스터코드는 공급사에서 지운다. 제원은 원자 수집 시트.
 * ★모델·세부모델·세부트림이 행키 바로 뒤에 붙어 있으면 정제칸(제조사(정제) 다음)으로 옮긴다.
 * ★색 정제칸(외장색상·내장색상)이 빠졌으면 차종구분 뒤에 넣는다.
 *
 *   npx tsx scripts/insert-encar-code-columns.mts
 *   npx tsx scripts/insert-encar-code-columns.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  AI_TAIL_COLUMNS, ENCAR_CODE_BLOCK, ENCAR_OLD_TRIM_CODE_COLUMN, ENCAR_RETIRED_COLUMNS,
  ENCAR_SPEC_BLOCK, ENCAR_TRIM_KEY_COLUMN, SHEET_NAME_MATCH, buildHeaderOwnerColors, columnWidth, isOurNonInventoryTab, supplierSheetLabel,
} from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONE = arg('sheet');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const NOTE = (name: string) => AI_TAIL_COLUMNS.find((c) => c.name === name)?.note || '';
const BLOCK = [...ENCAR_CODE_BLOCK, ...ENCAR_SPEC_BLOCK];
/** 기본스펙 뒤에 남는 정제칸 — 행키 삽입 때 밀려 사라졌다. 색·옵션·ERP코드는 여기. */
const AFTER_SPEC = ['차종코드', '선택옵션', '외장색상', '내장색상', '차종분류'] as const;
const NAMES = ['모델', '세부모델', '세부트림'];
const DROP_AFTER = [...ENCAR_RETIRED_COLUMNS];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
let targets: { id: string; name: string }[] = [];
if (ONE) targets.push({ id: ONE, name: ONE });
else {
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) {
    const name = S(f.name);
    if (/\[구버전[·・]?폐기\]/.test(name)) continue;
    targets.push({ id: S(f.id), name: supplierSheetLabel(name) });
  }
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

const doneShape = (hdr: string[], polAt: number) => {
  if (polAt < 0) return false;
  for (let k = 0; k < BLOCK.length; k++) {
    if (norm(hdr[polAt + 1 + k] || '') !== norm(BLOCK[k])) return false;
  }
  const afterAt = polAt + 1 + BLOCK.length;
  for (let k = 0; k < AFTER_SPEC.length; k++) {
    if (norm(hdr[afterAt + k] || '') !== norm(AFTER_SPEC[k])) return false;
  }
  if (hdr.some((h) => norm(h) === norm(ENCAR_OLD_TRIM_CODE_COLUMN))) return false;
  if (DROP_AFTER.some((n) => hdr.some((h) => norm(h) === norm(n)))) return false;
  if (NAMES.includes(hdr[polAt + 1 + BLOCK.length] || '')) return false;
  return true;
};

console.log(`■ 엔카 행키+기본스펙+색(정책코드 다음) ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳 · ${[...BLOCK, ...AFTER_SPEC].join(' | ')}`);
let done = 0, skipped = 0;
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,hidden,gridProperties(columnCount))`);
  for (const sh of (meta.sheets || []) as Rec[]) {
    const p = sh.properties; const title = S(p.title);
    if (p.hidden || isOurNonInventoryTab(title)) continue;
    const loadHdr = async () => (((await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:DZ1`)}`) as { values?: string[][] }).values || [])[0] || []).map(S);
    let hdr = await loadHdr();
    if (!hdr.some((c) => norm(c) === '차명(세부모델+트림)') || !hdr.some((c) => norm(c) === '차량번호')) continue;
    const polAt = hdr.findIndex((h) => norm(h) === '정책코드');
    if (polAt < 0) continue;
    const junk = hdr.map((h, i) => ({ h, i })).filter((x) => /^Column\s*\d+$/i.test(x.h));
    if (doneShape(hdr, polAt) && !junk.length) { skipped++; console.log(`  · ${t.name.padEnd(10)} 「${title}」 이미 규격`); continue; }
    const steps: string[] = [];
    const gid = p.sheetId;
    const drop = async (name: string) => {
      const i = hdr.findIndex((h) => norm(h) === norm(name));
      if (i < 0) return;
      if (!APPLY) { steps.push(`지우기 ${name}@${colA1(i)}`); hdr = hdr.filter((_, k) => k !== i); return; }
      await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 } } }] }) });
      hdr = hdr.filter((_, k) => k !== i);
      steps.push(`지우기 ${name}`);
    };
    const rename = async (from: string, to: string) => {
      const i = hdr.findIndex((h) => norm(h) === norm(from));
      if (i < 0) return;
      if (hdr.some((h) => norm(h) === norm(to))) return;
      if (!APPLY) { hdr[i] = to; steps.push(`이름 ${from}→${to}`); return; }
      await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!${colA1(i)}1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [[to]] }) });
      hdr[i] = to;
      steps.push(`이름 ${from}→${to}`);
    };
    const place = async (name: string, dest: number) => {
      const i = hdr.findIndex((h) => norm(h) === norm(name));
      if (i === dest) return;
      if (!APPLY) { steps.push(i < 0 ? `넣기 ${name}@${colA1(dest)}` : `옮기기 ${name} ${colA1(i)}→${colA1(dest)}`); return; }
      if (i < 0) {
        const reqs: Rec[] = [];
        if (dest >= hdr.length) reqs.push({ appendDimension: { sheetId: gid, dimension: 'COLUMNS', length: dest + 1 - hdr.length } });
        reqs.push({ insertDimension: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: dest, endIndex: dest + 1 }, inheritFromBefore: false } });
        await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
        hdr = [...hdr.slice(0, dest), name, ...hdr.slice(dest)];
        await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!${colA1(dest)}1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [[name]] }) });
        await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
          ...buildHeaderOwnerColors(gid, hdr.map((n) => ({ name: n }))),
          { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: dest, endColumnIndex: dest + 1 }, cell: { note: NOTE(name) }, fields: 'note' } },
          { updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: dest, endIndex: dest + 1 }, properties: { pixelSize: columnWidth(name) }, fields: 'pixelSize' } },
        ] }) });
        steps.push(`넣기 ${name}`);
        return;
      }
      await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ moveDimension: { source: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, destinationIndex: dest } }] }) });
      const n = hdr.splice(i, 1)[0];
      const d = i < dest ? dest - 1 : dest;
      hdr.splice(d, 0, n);
      steps.push(`옮기기 ${name}`);
    };
    console.log(`  ${APPLY ? '✓' : '→'} ${t.name.padEnd(10)} 「${title}」`);
    await rename(ENCAR_OLD_TRIM_CODE_COLUMN, ENCAR_TRIM_KEY_COLUMN);
    if (APPLY) { hdr = await loadHdr(); await sleep(200); }
    for (let k = 0; k < BLOCK.length; k++) {
      await place(BLOCK[k], polAt + 1 + k);
      if (APPLY) { hdr = await loadHdr(); await sleep(250); }
    }
    if (APPLY) hdr = await loadHdr();
    const specEnd = hdr.findIndex((h) => norm(h) === norm(BLOCK[BLOCK.length - 1]));
    if (specEnd >= 0) {
      for (let k = 0; k < AFTER_SPEC.length; k++) {
        await place(AFTER_SPEC[k], specEnd + 1 + k);
        if (APPLY) { hdr = await loadHdr(); await sleep(250); }
      }
    }
    for (const name of DROP_AFTER) {
      await drop(name);
      if (APPLY) await sleep(200);
    }
    if (hdr.some((h) => norm(h) === norm(ENCAR_TRIM_KEY_COLUMN))) {
      await drop(ENCAR_OLD_TRIM_CODE_COLUMN);
      if (APPLY) await sleep(200);
    }
    if (APPLY) hdr = await loadHdr();
    const lastCode = hdr.findIndex((h) => norm(h) === norm(BLOCK[BLOCK.length - 1]));
    const namesStuck = lastCode >= 0 && NAMES.includes(hdr[lastCode + 1] || '');
    if (namesStuck) {
      const makerAt = hdr.findIndex((h) => norm(h) === '제조사(정제)');
      if (makerAt >= 0) {
        for (let k = 0; k < NAMES.length; k++) {
          await place(NAMES[k], makerAt + 1 + k);
          if (APPLY) { hdr = await loadHdr(); await sleep(200); }
        }
      }
    }
    hdr = await loadHdr();
    const still = hdr.map((h, i) => ({ h, i })).filter((x) => /^Column\s*\d+$/i.test(x.h));
    if (still.length) {
      if (APPLY) {
        await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: still.sort((a, b) => b.i - a.i).map((x) => ({ deleteDimension: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: x.i, endIndex: x.i + 1 } } })) }) });
      }
      steps.push(`찌꺼기 ${still.map((x) => x.h).join(',')}`);
    }
    if (steps.length) console.log(`     ${steps.join(' · ')}`);
    else if (!APPLY) console.log(`     행키 3 + 기본스펙 · 차종트림코드→세부트림행키`);
    done++;
    if (APPLY) await sleep(400);
  }
}
console.log(APPLY ? `  반영 탭 ${done} · 이미 있음 ${skipped}` : `※ dry-run. 반영은 --apply (이미 있음 ${skipped})`);
