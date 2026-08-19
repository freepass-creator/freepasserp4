/**
 * **재고 탭 빈 칸 점검(+채움)** — 차량번호가 있는 줄에서 칸마다 빈 곳을 세고, «다른 칸에서 그대로 알 수 있는» 빈 칸만 채운다.
 * 기본은 점검만(읽기), 채움은 `--fill --apply`.
 *
 * ★사장님 2026-08-18 — 「빈 곳 있는지 봐줘봐 — 각 칸 하나씩 다 보라고. 아이카에 분류가 빠진 게 있는데」
 * ★채우는 규칙(지어내지 않는다 — 같은 사실의 다른 표기만):
 *   · 제조사 ← 제조사(정제) · 연료 ← 연료(정제) · 배기량 ← 배기량(정제) · 외부색상 ← 외장색상 · 내부색상 ← 내장색상  (정제칸 → 앞칸, 비어 있을 때만)
 *   · 연식 ← 최초등록일의 연도(4자리) — 모델연식이 아니라 «등록 연도»다. 안내 탭에 그렇게 적는다.
 *   · 상태 비면 「출고협의」 — ERP·발행기가 빈 상태를 그렇게 본다(canonSheetVehicleStatus). 눈에 보이게 적어 둔다.
 *   · 분류 비면: 구독재고 탭 → 「중고구독」 / 그 밖은 그 탭의 다른 줄이 전부 한 값이면 그 값 · 아니면 안 채우고 목록에.
 *   · 정책코드·정제칸·사진링크·최초등록일 은 세기만 한다(정제칸은 fill-supplier-ai-columns, 정책코드는 사람/정책 미러).
 * ★정제시트 4곳은 기본 제외(`--include-mirror`).
 *
 *   npx tsx scripts/audit-stock-gaps.mts
 *   npx tsx scripts/audit-stock-gaps.mts --fill --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { excludeMirrorSheets } from '../lib/domain/mirror-sources';
import { SHEET_NAME_MATCH, isDividerColumn, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const FILL = process.argv.includes('--fill');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONE = arg('sheet');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const WATCH = ['상태', '분류', '제조사', '차명(트림)', '옵션', '외부색상', '내부색상', '연식', '주행거리', '연료', '배기량', '차량가격', '최초등록일', '사진링크', '정책코드', '차종코드', '모델', '세부모델', '세부트림'];
const FROM_AI: [string, string][] = [['제조사', '제조사(정제)'], ['연료', '연료(정제)'], ['배기량', '배기량(정제)'], ['외부색상', '외장색상'], ['내부색상', '내장색상']];

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
  for (const f of ((r.files || []) as Rec[])) targets.push({ id: S(f.id), name: supplierSheetLabel(S(f.name)) });
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  targets = excludeMirrorSheets(targets);
}
console.log(`■ 재고 탭 빈 칸 점검${FILL ? (APPLY ? ' + 채움 반영' : ' + 채움 미리보기') : ''} — ${targets.length}곳\n`);
const report: string[] = [];
const totals = new Map<string, number>();
let fillTotal = 0;
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,hidden)`);
  for (const sh of (meta.sheets || []) as Rec[]) {
    const p = sh.properties; const title = S(p.title);
    if (p.hidden || isOurNonInventoryTab(title)) continue;
    const v = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}`) as { values?: string[][] };
    const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
    const hi = rows.findIndex((r) => r.some((c) => norm(c) === '차명(트림)'));
    if (hi < 0) continue;
    const hdr = rows[hi]; const at = new Map<string, number>(); hdr.forEach((h, i) => { if (h && !at.has(norm(h))) at.set(norm(h), i); });
    const pi = at.get('차량번호') ?? -1; if (pi < 0) continue;
    const body = rows.slice(hi + 1).map((r, k) => ({ r, rowNo: hi + 2 + k })).filter((x) => S(x.r[pi]));
    if (!body.length) { console.log(`  · ${t.name.padEnd(10)} 「${title}」 차 0대`); continue; }
    const periodCols = hdr.map((h, i) => (/개월/.test(h) ? i : -1)).filter((i) => i >= 0);
    const gaps: string[] = [];
    for (const name of WATCH) {
      const ci = at.get(norm(name)); if (ci === undefined) continue;
      const n = body.filter((x) => !S(x.r[ci])).length;
      if (n) { gaps.push(`${name} ${n}`); totals.set(name, (totals.get(name) || 0) + n); }
    }
    const noMoney = body.filter((x) => periodCols.every((i) => !S(x.r[i])) && !/출고불가/.test(S(x.r[at.get('상태') ?? -1]))).length;
    if (noMoney) { gaps.push(`대여료 전부 빈 차(출고불가 아님) ${noMoney}`); totals.set('대여료없음', (totals.get('대여료없음') || 0) + noMoney); }
    // ── 채움 계획
    const writes: { range: string; values: string[][] }[] = [];
    const filledBy = new Map<string, number>();
    const put = (ci: number, rowNo: number, val: string, why: string) => { writes.push({ range: `'${title.replace(/'/g, "''")}'!${colA1(ci)}${rowNo}`, values: [[val]] }); filledBy.set(why, (filledBy.get(why) || 0) + 1); };
    if (FILL) {
      for (const [dst, src] of FROM_AI) {
        const di = at.get(norm(dst)); const si = at.get(norm(src)); if (di === undefined || si === undefined) continue;
        for (const x of body) if (!S(x.r[di]) && S(x.r[si])) put(di, x.rowNo, S(x.r[si]), `${dst}←${src}`);
      }
      const yi = at.get('연식'); const ri = at.get('최초등록일');
      if (yi !== undefined && ri !== undefined) for (const x of body) { const m = /^(20\d\d|19\d\d)/.exec(S(x.r[ri])); if (!S(x.r[yi]) && m) put(yi, x.rowNo, m[1], '연식←최초등록 연도'); }
      const si = at.get('상태'); if (si !== undefined) for (const x of body) if (!S(x.r[si])) put(si, x.rowNo, '출고협의', '상태←출고협의(빈칸 규칙)');
      const ti = at.get('분류');
      if (ti !== undefined) {
        const have = [...new Set(body.map((x) => S(x.r[ti])).filter(Boolean))];
        const one = /구독/.test(title) ? '중고구독' : (have.length === 1 ? have[0] : '');
        for (const x of body) if (!S(x.r[ti])) { if (one) put(ti, x.rowNo, one, `분류←${/구독/.test(title) ? '구독탭' : '탭 단일값'}`); }
        const left = body.filter((x) => !S(x.r[ti])).length - (one ? body.filter((x) => !S(x.r[ti])).length : 0);
        if (!one && body.some((x) => !S(x.r[ti]))) gaps.push(`분류 못 채움(탭에 값이 ${have.join('/')} 섞임)`);
        void left;
      }
    }
    const line = `${t.name.padEnd(10)} 「${title}」 ${body.length}대 · 빈 곳: ${gaps.length ? gaps.join(' · ') : '없음'}${writes.length ? ` · 채움 ${writes.length}(${[...filledBy].map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}`;
    console.log(`  ${writes.length && APPLY ? '✓' : '·'} ${line}`);
    report.push(line);
    if (FILL && APPLY && writes.length) {
      for (let i = 0; i < writes.length; i += 500) await call(`${SH}/${t.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: writes.slice(i, i + 500) }) });
      fillTotal += writes.length; await sleep(800);
    }
  }
}
console.log(`\n  칸별 빈 곳 합계: ${[...totals].map(([k, n]) => `${k} ${n}`).join(' · ') || '없음'}${FILL ? `\n  ${APPLY ? '채움' : '채울 것'} ${fillTotal || '(미리보기)'}` : ''}`);
writeFileSync('tmp/stock-gaps-report.txt', report.join('\n'));
