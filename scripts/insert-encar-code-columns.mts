/**
 * **재고 탭에 「차종트림코드」「차종마스터코드」를 정책코드 바로 뒤에 넣는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-20 — 공급사시트 맨 끝(우리 칸) · 정책코드 다음에 엔카 중고차 코드를 입력할 수 있게.
 *   · 차종트림코드 = 원자ID `U-0001` (세부모델×세부트림×연료×배기량×인승×구동)
 *   · 차종마스터코드 = 세부모델ID `SM-0001`
 *   ERP 「차종코드」(트림행키)와 다른 칸이다. 값은 안 채운다 — 심는 것은 `stamp-encar-codes-on-supplier.mts`.
 * ★열을 **넣기만** 한다(insertDimension) — 값·서식은 열과 함께 밀린다. 이미 있으면 건너뛴다.
 * ★21곳 전부(정제시트 포함) — 코드 칸은 재고가 있는 곳에 같아야 한다.
 *
 *   npx tsx scripts/insert-encar-code-columns.mts
 *   npx tsx scripts/insert-encar-code-columns.mts --apply
 *   npx tsx scripts/insert-encar-code-columns.mts --apply --sheet=<ID>
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  AI_TAIL_COLUMNS, ENCAR_MASTER_CODE_COLUMN, ENCAR_TRIM_CODE_COLUMN, SHEET_NAME_MATCH,
  buildHeaderOwnerColors, columnWidth, isOurNonInventoryTab, supplierSheetLabel,
} from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONE = arg('sheet');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };

const NEW_COLS = [ENCAR_TRIM_CODE_COLUMN, ENCAR_MASTER_CODE_COLUMN];
const NOTE = (name: string) => AI_TAIL_COLUMNS.find((c) => c.name === name)?.note || '';

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
console.log(`■ 엔카 코드 열(정책코드 다음) ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳 · ${NEW_COLS.join(' · ')}`);
let done = 0, skipped = 0;
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,hidden,gridProperties(columnCount,rowCount))`);
  for (const sh of (meta.sheets || []) as Rec[]) {
    const p = sh.properties; const title = S(p.title);
    if (p.hidden || isOurNonInventoryTab(title)) continue;
    let hdr = (((await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:DZ1`)}`) as { values?: string[][] }).values || [])[0] || []).map(S);
    if (!hdr.some((c) => norm(c) === '차명(세부모델+트림)') || !hdr.some((c) => norm(c) === '차량번호')) continue;
    const missing = NEW_COLS.filter((n) => !hdr.some((h) => norm(h) === norm(n)));
    if (!missing.length) {
      const polAt = hdr.findIndex((h) => norm(h) === '정책코드');
      const trimAt = hdr.findIndex((h) => norm(h) === norm(ENCAR_TRIM_CODE_COLUMN));
      const masterAt = hdr.findIndex((h) => norm(h) === norm(ENCAR_MASTER_CODE_COLUMN));
      const ok = polAt >= 0 && trimAt === polAt + 1 && masterAt === polAt + 2;
      skipped++;
      console.log(`  · ${t.name.padEnd(10)} 「${title}」 ${ok ? '이미 규격(정책코드 다음)' : `이미 있음 ${colA1(trimAt)}·${colA1(masterAt)}`}`);
      continue;
    }
    const polAt = hdr.findIndex((h) => norm(h) === '정책코드');
    const at = polAt >= 0 ? polAt + 1 : hdr.length;
    console.log(`  ${APPLY ? '✓' : '→'} ${t.name.padEnd(10)} 「${title}」 ${colA1(at)}열에 ${missing.join(' · ')} 삽입`);
    if (!APPLY) continue;
    const gid = p.sheetId;
    const width = Number(p.gridProperties?.columnCount) || hdr.length;
    const reqs: Rec[] = [];
    if (at + missing.length > width) {
      reqs.push({ appendDimension: { sheetId: gid, dimension: 'COLUMNS', length: at + missing.length - width } });
    }
    reqs.push({ insertDimension: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: at, endIndex: at + missing.length }, inheritFromBefore: false } });
    await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
    hdr = [...hdr.slice(0, at), ...missing, ...hdr.slice(at)];
    const values: string[][] = [missing];
    await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!${colA1(at)}1:${colA1(at + missing.length - 1)}1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values }) });
    await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
      ...buildHeaderOwnerColors(gid, hdr.map((name) => ({ name }))),
      ...missing.map((name, k) => ({
        repeatCell: {
          range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: at + k, endColumnIndex: at + k + 1 },
          cell: { note: NOTE(name) },
          fields: 'note',
        },
      })),
      ...missing.map((name, k) => ({
        updateDimensionProperties: {
          range: { sheetId: gid, dimension: 'COLUMNS', startIndex: at + k, endIndex: at + k + 1 },
          properties: { pixelSize: columnWidth(name) },
          fields: 'pixelSize',
        },
      })),
    ] }) });
    done++;
    await sleep(800);
  }
}
console.log(APPLY ? `  반영 탭 ${done} · 이미 있음 ${skipped}` : `※ dry-run. 반영은 --apply (이미 있음 ${skipped})`);
