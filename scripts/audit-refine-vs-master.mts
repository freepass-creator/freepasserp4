/**
 * **정제칸 ↔ 「차종마스터 신규」 시트 전수 대조(읽기 전용).**
 *
 * ★사장님 2026-08-21 「정제시트 정제칸에 차종마스터 신규로 다 채워넣었어… 검증해봐」
 *   → 「차종마스터 신규 파일 있거든?」 + 링크.
 *
 * ★★사전이 무엇인지부터 시트에 물어야 한다 — 내가 두 번 틀린 자리다.
 *   그 시트 「안내」 탭이 스스로 이렇게 적고 있다:
 *     · 「프리패스 ERP 원장 「차종마스터」(mf-…)는 보지 않는다. **이 시트가 차명·제원 사전이다.**」
 *     · 「이 시트가 정본. 연식·연료·배기량·구동·**차종크기·차종구분은 이 시트 칸.**」
 *     · 「이 시트(엔카) = 르노코리아 · KG모빌리티. **공급사 칸 = 르노 · KGM.
 *        제조사(정제)에는 공급사 표기를 넣는다.**」
 *   1차 감사는 `public/data/vehicle-master.json` 을 사전으로 삼고 제조사도 시트 표기로 견줘서
 *   **「제조사 어긋남 55건」을 지어냈다** — 규칙대로 맞게 들어간 값이었다. `canonMakerDisplay` 로 접는다.
 *   ⇒ **도구를 돌리기 전에 그 도구가 무엇을 정본으로 읽는지 먼저 확인한다.**
 *
 * ★무엇을 보나 — 팔 수 있는 줄(출고불가 아님)마다
 *   ① 채웠나        핵심 6칸(제조사(정제)·모델·세부모델·연료(정제)·차종크기·차종구분)
 *   ② 이름이 있나    세부모델이 시트에 있는가
 *   ③ 값이 맞나      제조사(접은 이름)·1차모델·원산지가 시트와 같은가
 *   ④ 갈래가 맞나    연료·배기량이 그 세부모델의 원자(U) 안에 있는가
 *   ⑤ 차급이 맞나    차종크기·차종구분이 시트 칸과 같은가  ← 이게 정본이다
 *   ⑥ 합친 게 맞나   차종분류 = 차종크기 + 차종구분
 *
 * ★아무것도 안 고친다. 목록은 tmp/refine-vs-master.json.
 *
 *   npx tsx scripts/audit-refine-vs-master.mts
 *   npx tsx scripts/audit-refine-vs-master.mts --only=아이카,오토플러스
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';
import { ENCAR_MASTER_SHEET_ID } from '../lib/domain/legacy-sheets';
import { canonMakerDisplay } from '../lib/domain/maker-display';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const key = (v: unknown) => norm(v).toLowerCase().replace(/[()（）\-_.·,/]/g, '');
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const ONLY = new Set(arg('only').split(',').map(S).filter(Boolean));
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

// ── 인증
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const call = async (u: string): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(20_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 120)}`);
  }
};

// ── 사전 = 「차종마스터 신규」 시트 「차종마스터」 탭. 한 줄이 원자(U) 하나다.
type Atom = { fuel: string; cc: number; liter: number; drive: string };
type Spec = { maker: string; model: string; origin: string; size: string; kind: string; atoms: Atom[] };
const SPEC = new Map<string, Spec>();          // 세부모델 이름 → 규격
{
  const rows = ((await call(`https://sheets.googleapis.com/v4/spreadsheets/${ENCAR_MASTER_SHEET_ID}/values/${encodeURIComponent('차종마스터!A1:AB5000')}`)).values || []) as string[][];
  const h = (rows[0] || []).map(norm);
  const at = (n: string) => h.indexOf(norm(n));
  const [ci, oi, mi, mo, si, fi, cc, li, di, zi, ki] = ['세부모델', '원산지', '제조사', '1차모델', '세부모델', '연료', '정확배기량(cc)', '표시배기량(L)', '구동방식', '차종크기', '차종구분'].map(at);
  if (ci < 0 || zi < 0 || ki < 0) throw new Error(`「차종마스터」 탭 머리행이 낯설다: ${h.filter(Boolean).slice(0, 10).join('·')}`);
  for (const r of rows.slice(1)) {
    const sub = S(r[si]); if (!sub) continue;
    const k = key(sub);
    const cur = SPEC.get(k) || { maker: canonMakerDisplay(S(r[mi])), model: S(r[mo]), origin: S(r[oi]), size: S(r[zi]), kind: S(r[ki]), atoms: [] };
    cur.atoms.push({ fuel: S(r[fi]), cc: Number(S(r[cc]).replace(/[^0-9]/g, '')) || 0, liter: Number(S(r[li])) || 0, drive: S(r[di]) });
    // ★차급은 그 세부모델 안에서 갈리지 않아야 정상이다. 갈리면 첫 줄을 쓰고 아래에서 「시트가 갈림」으로 센다.
    if (!cur.size && S(r[zi])) cur.size = S(r[zi]);
    if (!cur.kind && S(r[ki])) cur.kind = S(r[ki]);
    SPEC.set(k, cur);
  }
  console.log(`■ 사전 — 「차종마스터 신규」 시트 「차종마스터」 탭 ${rows.length - 1}줄 → 세부모델 ${SPEC.size}종`);
}

const MIRROR = new Set(MIRROR_SOURCES.map((m) => m.name));
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const books = (((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || []) as Rec[])
  .map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.label.localeCompare(b.label));

const CORE = ['제조사(정제)', '모델', '세부모델', '연료(정제)', '차종크기', '차종구분'];
type Issue = { supplier: string; mirror: boolean; plate: string; kind: string; detail: string };
const issues: Issue[] = [];
let cars = 0, blankCore = 0, named = 0;
const perSupplier = new Map<string, { cars: number; blank: number; bad: number }>();

for (const b of books) {
  if (ONLY.size && !ONLY.has(b.label)) continue;
  const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}?fields=sheets.properties(title,hidden)`);
  for (const p of ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec)) {
    const tab = S(p.title);
    if (p.hidden || isOurNonInventoryTab(tab) || !/재고/.test(tab) || /상품시트/.test(tab)) continue;
    let rows: string[][];
    try {
      rows = (((await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values/${encodeURIComponent(`${tab}!A1:CZ700`)}`)).values || []) as string[][]);
    } catch { continue; }
    const hi = rows.findIndex((r) => r.some((c) => norm(c) === '차량번호'));
    if (hi < 0) continue;
    const h = rows[hi].map(norm);
    const at = (name: string) => h.indexOf(norm(name));
    const pi = at('차량번호'), si = at('상태');
    for (const r of rows.slice(hi + 1)) {
      const plate = norm(r[pi]);
      if (!plate) continue;
      if (/출고불가|판매완료|말소/.test(si >= 0 ? S(r[si]) : '')) continue;   // 팔 수 있는 줄만 본다
      cars++;
      const st = perSupplier.get(b.label) || { cars: 0, blank: 0, bad: 0 };
      st.cars++; perSupplier.set(b.label, st);
      const g = (name: string) => { const i = at(name); return i >= 0 ? S(r[i]) : ''; };
      const mirror = MIRROR.has(b.label);
      const add = (kind: string, detail: string) => { issues.push({ supplier: b.label, mirror, plate, kind, detail }); st.bad++; };

      // ① 채웠나
      const missing = CORE.filter((c) => !g(c));
      if (missing.length) { blankCore++; st.blank++; add('안 채움', `빈 칸 ${missing.length}: ${missing.join(' · ')}`); continue; }

      // ② 이름이 있나
      const sub = g('세부모델');
      const e = SPEC.get(key(sub));
      if (!e) {
        const near = [...SPEC.keys()].filter((x) => x.includes(key(sub).slice(0, 4))).slice(0, 2)
          .map((x) => [...SPEC.entries()].find(([kk]) => kk === x)?.[0] || x);
        add('시트에 없는 세부모델', `「${sub}」${near.length ? ` — 비슷한 것: ${near.join(' · ')}` : ''}`);
        continue;
      }
      named++;

      // ③ 값이 맞나 — 제조사는 **공급사 표기로 접어서** 견준다(안내: 「제조사(정제)에는 공급사 표기를 넣는다」)
      if (key(canonMakerDisplay(g('제조사(정제)'))) !== key(e.maker)) add('제조사 어긋남', `정제칸 「${g('제조사(정제)')}」 ↔ 시트 「${e.maker}」 (${sub})`);
      if (key(g('모델')) !== key(e.model)) add('모델 어긋남', `정제칸 「${g('모델')}」 ↔ 시트 「${e.model}」 (${sub})`);
      const origin = g('원산지');
      if (origin && e.origin && key(origin) !== key(e.origin)) add('원산지 어긋남', `정제칸 「${origin}」 ↔ 시트 「${e.origin}」 (${sub})`);

      // ④ 갈래가 맞나
      const fuel = g('연료(정제)');
      const fuels = [...new Set(e.atoms.map((a) => a.fuel).filter(Boolean))];
      if (fuel && fuels.length && !fuels.some((f) => key(f) === key(fuel))) {
        add('연료 어긋남', `정제칸 「${fuel}」 ↔ 시트 ${fuels.join('/')} (${sub})`);
      }
      const disp = g('배기량(정제)').replace(/[^0-9.]/g, '');
      if (disp) {
        const n = Number(disp);
        const ccs = [...new Set(e.atoms.map((a) => a.cc).filter(Boolean))];
        const ls = [...new Set(e.atoms.map((a) => a.liter).filter(Boolean))];
        const okCc = n > 100 && ccs.some((c) => Math.abs(c - n) <= 3);
        const okL = ls.some((l) => Math.abs(l - (n > 100 ? n / 1000 : n)) < 0.06);
        if (ccs.length + ls.length && !okCc && !okL) {
          add('배기량 어긋남', `정제칸 「${g('배기량(정제)')}」 ↔ 시트 ${(ccs.length ? ccs.slice(0, 4).join('/') + 'cc' : ls.join('/') + 'L')} (${sub})`);
        }
      }

      // ⑤ 차급이 맞나 — **시트 칸이 정본이다**
      const size = g('차종크기'), kind = g('차종구분');
      if (e.size && key(size) !== key(e.size)) add('차종크기 어긋남', `정제칸 「${size}」 ↔ 시트 「${e.size}」 (${sub})`);
      if (e.kind && key(kind) !== key(e.kind)) add('차종구분 어긋남', `정제칸 「${kind}」 ↔ 시트 「${e.kind}」 (${sub})`);

      // ⑥ 합친 게 맞나
      const cls = g('차종분류');
      const want = `${size} ${kind}`.trim();
      if (cls && norm(cls) !== norm(want)) add('차종분류 어긋남', `「${cls}」 ↔ 차종크기+차종구분 「${want}」 — ${sub}`);
    }
  }
}

const byKind = new Map<string, number>();
for (const i of issues) byKind.set(i.kind, (byKind.get(i.kind) || 0) + 1);
console.log(`\n■ 정제칸 ↔ 「차종마스터 신규」 — 팔 수 있는 차 ${cars}대 (이름이 시트에 있는 ${named}대 · 핵심칸 빈 ${blankCore}대)`);
console.log(`  어긋난 건 ${issues.length}건 — ${[...byKind].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')}\n`);

console.log('  ── 공급사별');
for (const [name, st] of [...perSupplier].sort((a, b) => b[1].bad - a[1].bad)) {
  const tag = MIRROR.has(name) ? '정제시트' : '        ';
  const rate = st.cars ? Math.round(((st.cars - st.blank) / st.cars) * 100) : 0;
  console.log(`   ${tag} ${name.slice(0, 12).padEnd(13)} 차 ${String(st.cars).padStart(3)}대 · 채움 ${String(rate).padStart(3)}% · 어긋남 ${st.bad}`);
}

console.log('\n  ── 어긋난 줄');
for (const i of issues) console.log(`   ${(i.mirror ? '★' : ' ')}${i.supplier.slice(0, 10).padEnd(11)} ${i.plate.padEnd(10)} ${i.kind.padEnd(16)} ${i.detail}`);
writeFileSync('tmp/refine-vs-master.json', JSON.stringify({ cars, named, blankCore, issues }, null, 2));
console.log('\n  목록 tmp/refine-vs-master.json — 아무것도 고치지 않았다.\n');
