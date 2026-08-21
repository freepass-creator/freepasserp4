/**
 * **정제칸 중 «같은 줄 원문에서만 나오는 칸»(선택옵션·외장색상·내장색상)을 원문 기준으로 다시 맞춘다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(2026-08-19 실측 — 강지수 팀장 「상품리스트 옵션이랑 색상이 다 달라요, 계약서 다시 수정했다」)
 *   손오공 「렌트재고」 15줄의 정제칸이 다른 차 것으로 밀려 있었다(161허1165 옵션이 161허1397 것 · 161하1266 외장 블랙→화이트 …).
 *   08-18 구버전 흡수 때 «자리 밀린 값»을 되돌리며 공급사 칸은 바로잡았지만 정제칸(우리 칸)은 그대로 남아 어긋났고,
 *   채우기(fill-supplier-ai-columns)는 «빈 칸만» 채우므로 잘못 든 값을 못 잡았다. 판매시트는 정제칸을 먼저 읽어 그대로 나갔다.
 * ★이 세 칸은 그 줄의 원문(옵션·외부색상·내부색상)에서만 결정된다 — 차종코드처럼 정본이 따로 없다. 그래서 «다시 계산해 덮어도» 잃는 게 없다.
 *   선택옵션 = 옵션 원문(「AI 정제」 치환 사전 적용) · 외장색상/내장색상 = 규격색(밖이면 기타). 원문이 비면 손대지 않는다.
 * ★run-daily ② 앞에서 매일 돌린다(멱등) — 밀림이 생겨도 다음 반영 때 스스로 맞춘다.
 *
 *   npx tsx scripts/realign-derived-cells.mts
 *   npx tsx scripts/realign-derived-cells.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { snapColorOrEtc } from '../lib/domain/color-master';
import { loadColorMasterAliases } from '../lib/domain/color-master-sheet';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const SALES_SHEET = '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';
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

// 치환 사전(발행기·fill 과 같은 것)
const SUBST = new Map<string, string>();
try {
  const v = await call(`${SH}/${SALES_SHEET}/values/${encodeURIComponent("'AI 정제'!A1:C2000")}`) as { values?: string[][] };
  for (const r of ((v.values || []) as string[][])) { const kind = S(r[0]), from = S(r[1]), to = S(r[2]); if (!kind.startsWith('@') || kind === '@설명' || !from || !to) continue; SUBST.set(`${kind.slice(1)}|${from}`, to); }
} catch { /* 없으면 치환 없이 */ }
const clean = (col: string, val: string) => SUBST.get(`${col}|${S(val)}`) ?? S(val);
try { await loadColorMasterAliases(call as (u: string) => Promise<Record<string, unknown>>); } catch { /* 코드 별칭만 */ }

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const suppliers = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), name: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
console.log(`■ 정제칸(선택옵션·외장색상·내장색상) 원문 기준 재정렬 ${APPLY ? '반영' : '미리보기'} — ${suppliers.length}곳`);
const PAIRS: { rawCols: string[]; derivedCol: string; fn: (v: string) => string }[] = [
  { rawCols: ['옵션'], derivedCol: '선택옵션', fn: (v) => clean('옵션', v) },
  { rawCols: ['외부색상', '외장색', '색상'], derivedCol: '외장색상', fn: (v) => snapColorOrEtc(v, 'ext') },
  { rawCols: ['내부색상', '내장색'], derivedCol: '내장색상', fn: (v) => snapColorOrEtc(v, 'int') },
];
let fixed = 0; const list: string[] = [];
for (const t of suppliers) {
  const m = await call(`${SH}/${t.id}?fields=sheets.properties(title,hidden)`);
  for (const sh of (m.sheets || []) as Rec[]) {
    const title = S(sh.properties.title); if (sh.properties.hidden || isOurNonInventoryTab(title)) continue;
    const rows = (((await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}`)).values || []) as string[][]).map((r) => r.map(S));
    const hi = rows.findIndex((r) => r.includes('차량번호') && r.some((c) => norm(c) === '차명(세부모델+트림)')); if (hi < 0) continue;
    const h = rows[hi]; const at = (x: string) => h.findIndex((y) => norm(y) === norm(x)); const pi = at('차량번호');
    const updates: { range: string; values: string[][] }[] = [];
    rows.slice(hi + 1).forEach((r, k) => {
      const plate = norm(r[pi]); if (!plate) return;
      for (const { rawCols, derivedCol, fn } of PAIRS) {
        const ri = rawCols.map((c) => at(c)).find((i) => i >= 0) ?? -1;
        const di = at(derivedCol); if (ri < 0 || di < 0) continue;
        const raw = S(r[ri]); const want = raw ? fn(raw) : ''; const now = S(r[di]);
        if (want === now) continue;
        if (!raw) continue;   // 원문이 비면 손대지 않는다(정제시트 once 칸·옛 채움이 남아 있을 수 있다 — 지우는 건 사람이)
        updates.push({ range: `'${title.replace(/'/g, "''")}'!${colA1(di)}${hi + 2 + k}`, values: [[want]] });
        fixed++; if (list.length < 25) list.push(`${t.name} ${plate} ${derivedCol} 「${now.slice(0, 30) || '(빔)'}」 → 「${want.slice(0, 30)}」`);
      }
    });
    if (updates.length && APPLY) { for (let i = 0; i < updates.length; i += 400) await call(`${SH}/${t.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: updates.slice(i, i + 400) }) }); await sleep(400); }
  }
}
console.log(`  바로잡을 칸 ${fixed}`); for (const l of list) console.log(`     ${l}`);
console.log(APPLY ? '  ✓ 반영' : '※ dry-run. 반영은 --apply');
