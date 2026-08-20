/**
 * **공급사 시트 전부의 「제조사」·「제조사(정제)」를 표기 규격(maker-display)으로 맞춘다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-18 — 「제조사는 르노라고만 하고 KGM — 매뉴얼에 박아서 모든 시트 통일해야지」
 *   르노삼성·르노(삼성)·르노코리아 → 르노 / KG모빌리티·KG모빌리티(쌍용)·쌍용 → KGM / 쉐보레(대우)·한국지엠 → 쉐보레 / 메르세데스 → 벤츠 …
 *   규격은 `lib/domain/maker-display.ts` 한 곳(드롭다운 목록 `HANDLED_MAKER_OPTIONS` 이름 그대로). 모르는 이름은 그대로 두고 세어 보여 준다.
 * ★「제조사(정제)」가 비어 있고 앞칸 「제조사」가 있으면 그 표준 이름을 넣는다 — 마스터 매칭이 안 된 차도 제조사만은 채운다.
 * ★값만 바꾼다. 서식·드롭다운·표는 안 건드린다. 정제시트·제공시트 가리지 않는다(사장님 「모든 시트」) — `--only-mirror` 로 정제시트만.
 *
 *   npx tsx scripts/unify-maker-names.mts
 *   npx tsx scripts/unify-maker-names.mts --apply
 *   npx tsx scripts/unify-maker-names.mts --apply --only-mirror
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { canonMakerDisplay, isStandardMaker } from '../lib/domain/maker-display';
import { isMirrorSheet } from '../lib/domain/mirror-sources';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const ONLY_MIRROR = process.argv.includes('--only-mirror');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONE = arg('sheet');
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const targets: { id: string; name: string }[] = [];
if (ONE) targets.push({ id: ONE, name: ONE });
else {
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) if (!ONLY_MIRROR || isMirrorSheet(S(f.id))) targets.push({ id: S(f.id), name: supplierSheetLabel(S(f.name)) });
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
console.log(`■ 제조사 표기 통일 ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳${ONLY_MIRROR ? '(정제시트만)' : ''}`);
let changed = 0, filled = 0;
const odd = new Map<string, number>();
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,hidden)`);
  for (const p of (meta.sheets || []).map((x: Rec) => x.properties)) {
    const title = S(p.title);
    if (p.hidden || isOurNonInventoryTab(title)) continue;
    const v = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'`)}`) as { values?: string[][] };
    const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
    const hi = rows.findIndex((r) => r.some((c) => norm(c) === '차명(세부모델+트림)'));
    if (hi < 0) continue;
    const hdr = rows[hi];
    const mi = hdr.findIndex((h) => norm(h) === '제조사'); const ai = hdr.findIndex((h) => norm(h) === '제조사(정제)');
    const pi = hdr.findIndex((h) => norm(h) === '차량번호');
    const data: { range: string; values: string[][] }[] = [];
    const seen = new Map<string, number>();
    rows.slice(hi + 1).forEach((r, k) => {
      if (pi >= 0 && !S(r[pi]) && !r.some(Boolean)) return;
      const rowAt = hi + 2 + k;
      const raw = mi >= 0 ? S(r[mi]) : '';
      const canon = canonMakerDisplay(raw);
      if (mi >= 0 && raw && canon !== raw) { data.push({ range: `'${title}'!${colA1(mi)}${rowAt}`, values: [[canon]] }); seen.set(`${raw}→${canon}`, (seen.get(`${raw}→${canon}`) || 0) + 1); }
      if (canon && !isStandardMaker(canon)) odd.set(canon, (odd.get(canon) || 0) + 1);
      if (ai >= 0) {
        const rawAi = S(r[ai]);
        if (rawAi) { const c2 = canonMakerDisplay(rawAi); if (c2 !== rawAi) { data.push({ range: `'${title}'!${colA1(ai)}${rowAt}`, values: [[c2]] }); seen.set(`(정제)${rawAi}→${c2}`, (seen.get(`(정제)${rawAi}→${c2}`) || 0) + 1); } }
        else if (canon && isStandardMaker(canon)) { data.push({ range: `'${title}'!${colA1(ai)}${rowAt}`, values: [[canon]] }); filled++; }
      }
    });
    if (!data.length) continue;
    console.log(`  ${APPLY ? '✓' : '→'} ${t.name.padEnd(10)} 「${title}」 ${data.length}칸 — ${[...seen].map(([k, n]) => `${k}×${n}`).join(' · ') || '(정제 빈칸 채움)'}`);
    changed += data.length;
    if (!APPLY) continue;
    await call(`${SH}/${t.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
  }
}
console.log(`\n  ${APPLY ? '반영' : '바꿀'} 칸 ${changed}(그중 정제 빈칸 채움 ${filled})${odd.size ? ` · 규격 밖 이름(그대로 둠): ${[...odd].map(([k, n]) => `${k}×${n}`).join(' · ')}` : ''}${APPLY ? '' : '\n※ dry-run. 반영은 --apply'}`);
