/**
 * **세부모델 이름에서 «프로젝트 코드»를 떼는 치환 규칙을 「AI 정제」 사전에 넣는다.**
 *
 * ★왜(사장님 2026-08-23 「109호5391 이상하다 · 아직도 세부모델 세부트림 정제되지 않은 게 있는 거 같음」)
 *   정제칸 「세부모델」은 `fill-supplier-ai-columns` 가 **차종마스터 이름을 그대로 옮긴 값**이라
 *   마스터에 박힌 프로젝트 코드가 그대로 따라온다 — 「디 올 뉴 싼타페 MX5」·「그랜저 GN7」·「G80 RG3」.
 *   화면 차명은 «세부모델 + 세부트림» 이라 손님·영업자에게 「디 올 뉴 싼타페 MX5 익스클루시브」로 나갔다.
 *   실측 648대 중 **487대(75%)** 가 그랬다.
 *
 * ★왜 시트를 직접 고치지 않고 사전에 넣나
 *   시트 값을 손으로 고쳐도 **다음 `fill` 실행이 마스터 값으로 도로 덮는다.** 사전(「AI 정제」)은
 *   `fill` 과 발행기가 **같이 읽는 자리**라 여기 한 줄이면 정제칸도 판매시트도 같이 따라온다.
 *   무엇보다 **사장님이 시트에서 눈으로 보고 고칠 수 있다**(「정제칸은 내가 확실하게 챙길게」).
 *
 * ★겹치는 이름은 «막지 않고 알린다»
 *   「그랜저 GN7」·「그랜저 IG」는 코드를 떼면 **둘 다 「그랜저」**가 된다. 그래도 기본은 **뗀다** —
 *   이름은 손님이 읽는 딱지이지 열쇠가 아니고(열쇠는 차종코드), 세대는 **연식**이 화면에서 가른다.
 *   마스터 매칭도 공급사 **원문 차명**으로 하므로 이 사전은 매칭을 건드리지 않는다.
 *   대신 겹치는 이름을 전부 찍어 준다 — 남기고 싶은 것은 「AI 정제」에서 그 줄만 지우면 된다.
 *   `--keep-colliding` 을 주면 겹치는 이름은 아예 규칙을 만들지 않는다.
 *
 *   npx tsx scripts/add-submodel-code-strip-rules.mts           # 무엇이 들어갈지 보기만
 *   npx tsx scripts/add-submodel-code-strip-rules.mts --apply   # 「AI 정제」에 붙이기
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { MASTER_SHEET_ID, SALES_SHEET_ID } from '../lib/domain/legacy-sheets';
import { stripModelCode } from '../lib/domain/submodel-code';
import { SHEET_NAME_MATCH, isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  // 공급사 시트를 찾으려면 drive 스코프도 있어야 한다 — spreadsheets 만으로는 Drive 검색이 403 이다.
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(3000 * 2 ** n); continue; }
    throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

/** 공급사 시트 정제칸에 **지금 적혀 있는** 세부모델을 긁는다 — 마스터에서 지워진 옛 이름도 손님 화면엔 살아 있다. */
async function collectRefinedSubModels(): Promise<{ maker: string; model: string; sub: string }[]> {
  const out = new Map<string, { maker: string; model: string; sub: string }>();
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const found = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of (found.files || [])) {
    const meta = await api(`${SH}/${S(f.id)}?fields=sheets.properties(title,hidden)`);
    for (const sh of (meta.sheets || [])) {
      const title = S(sh.properties.title);
      if (sh.properties.hidden || isOurNonInventoryTab(title)) continue;
      const v = await api(`${SH}/${S(f.id)}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:CZ700`)}`) as { values?: string[][] };
      const rows = ((v.values || []) as string[][]).map((r) => (r || []).map(S));
      const hi = rows.findIndex((r) => r.includes('차량번호'));
      if (hi < 0) continue;
      const head = rows[hi];
      const [iMaker, iModel, iSub] = ['제조사(정제)', '모델', '세부모델'].map((n) => head.indexOf(n));
      if (iSub < 0) break;
      for (const r of rows.slice(hi + 1)) {
        const sub = S(r[iSub]);
        if (!sub) continue;
        const maker = iMaker >= 0 ? S(r[iMaker]) : '';
        out.set(`${maker}|${sub}`, { maker, model: iModel >= 0 ? S(r[iModel]) : '', sub });
      }
      break;
    }
    await sleep(100);
  }
  return [...out.values()];
}

// ── ① 차종마스터에서 제조사·모델·세부모델을 모은다
const mv = await api(`${SH}/${MASTER_SHEET_ID}/values/${encodeURIComponent("'차종마스터'")}`) as { values?: string[][] };
const mrows = ((mv.values || []) as string[][]).map((r) => (r || []).map(S));
const mhead = mrows[0] || [];
const [cMaker, cModel, cSub] = ['제조사', '모델', '세부모델'].map((n) => mhead.indexOf(n));
if (cSub < 0) throw new Error('차종마스터에 「세부모델」 열이 없다 — 열 이름이 바뀌었는지 보라');

/**
 * 이름 모음 = **차종마스터 + 지금 공급사 정제칸에 실제로 적혀 있는 값**.
 * ⚠ 마스터만 보면 **시트에만 남은 옛 이름**이 빠진다 — 「올 뉴 렉스턴 Y450」·「모닝 JA」·「카니발 R VQ」가
 *   실제로 그랬다(2026-08-23: 규칙 179개를 넣고도 13대가 코드를 달고 남았다).
 *   옛 이름은 마스터에서 지워졌어도 시트에는 남아 손님 화면까지 간다.
 */
const names = new Map<string, { maker: string; model: string; sub: string }>();
for (const r of mrows.slice(1)) {
  const sub = S(r[cSub]);
  if (!sub) continue;
  const maker = cMaker >= 0 ? S(r[cMaker]) : '';
  names.set(`${maker}|${sub}`, { maker, model: cModel >= 0 ? S(r[cModel]) : '', sub });
}
const fromMaster = names.size;
for (const v of await collectRefinedSubModels()) if (!names.has(`${v.maker}|${v.sub}`)) names.set(`${v.maker}|${v.sub}`, v);
console.log(`  이름 모음 — 마스터 ${fromMaster}가지 + 시트에만 남은 옛 이름 ${names.size - fromMaster}가지 = ${names.size}가지\n`);

// ── ② 코드를 떼면 이름이 겹치는 것을 먼저 골라낸다
const strippedTo = new Map<string, Set<string>>();
for (const v of names.values()) {
  const after = stripModelCode(v.sub, v.model, v.maker);
  if (!after || after === v.sub) continue;
  const k = `${v.maker}|${after}`;
  const set = strippedTo.get(k) || new Set<string>();
  set.add(v.sub);
  strippedTo.set(k, set);
}
const collides = (maker: string, after: string) => (strippedTo.get(`${maker}|${after}`)?.size ?? 0) > 1;

// ── ③ 규칙을 만든다
const KEEP_COLLIDING = process.argv.includes('--keep-colliding');
const rules: { from: string; to: string; maker: string }[] = [];
const merged: { maker: string; sub: string; after: string }[] = [];
for (const v of names.values()) {
  const after = stripModelCode(v.sub, v.model, v.maker);
  if (!after || after === v.sub) continue;
  const clash = collides(v.maker, after);
  if (clash) merged.push({ maker: v.maker, sub: v.sub, after });
  if (clash && KEEP_COLLIDING) continue;
  rules.push({ from: v.sub, to: after, maker: v.maker });
}

// ── ④ 이미 사전에 있는 줄은 건드리지 않는다
const dv = await api(`${SH}/${SALES_SHEET_ID}/values/${encodeURIComponent("'AI 정제'!A1:D4000")}`) as { values?: string[][] };
const drows = ((dv.values || []) as string[][]).map((r) => (r || []).map(S));
const already = new Set(drows.filter((r) => S(r[0]) === '@세부모델').map((r) => S(r[1])));
const fresh = rules.filter((r) => !already.has(r.from));

console.log(`■ 세부모델 코드 떼기 규칙 — 마스터 이름 ${names.size}가지\n`);
console.log(`  규칙이 되는 이름   ${rules.length}가지 (이미 사전에 있음 ${rules.length - fresh.length} · 새로 넣을 것 ${fresh.length})`);
console.log(`  ${KEEP_COLLIDING ? '코드를 남기는' : '떼면 세대가 겹치는'} 이름  ${merged.length}가지\n`);

console.log('── 새로 넣을 규칙');
for (const r of fresh.slice(0, 400)) console.log(`  @세부모델  ${r.maker.padEnd(7)} 「${r.from}」 → 「${r.to}」`);
if (fresh.length > 400) console.log(`  … 외 ${fresh.length - 400}가지`);

if (merged.length) {
  console.log(`\n── ⚠ 코드를 떼면 **다른 세대가 같은 이름**이 되는 것${KEEP_COLLIDING ? ' (그래서 코드를 남겼다)' : ' (그래도 뗀다 — 세대는 연식이 가른다)'}`);
  console.log('   남기고 싶은 이름이 있으면 「AI 정제」에서 그 줄만 지우면 된다.\n');
  const byAfter = new Map<string, string[]>();
  for (const k of merged) { const a = byAfter.get(`${k.maker}|${k.after}`) || []; a.push(k.sub); byAfter.set(`${k.maker}|${k.after}`, a); }
  for (const [k, subs] of byAfter) console.log(`  ${k.split('|')[0].padEnd(7)} 「${k.split('|')[1]}」 ← ${subs.map((s) => `「${s}」`).join(' · ')}`);
}

if (!APPLY) { console.log('\n  (미리보기다 — 넣으려면 --apply)'); process.exit(0); }
if (!fresh.length) { console.log('\n  넣을 것이 없다.'); process.exit(0); }

const body = fresh.map((r) => ['@세부모델', r.from, r.to, `${r.maker} · 프로젝트 코드 떼기(2026-08-23)`]);
await api(`${SH}/${SALES_SHEET_ID}/values/${encodeURIComponent("'AI 정제'!A1")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
  method: 'POST', body: JSON.stringify({ values: body }),
});
console.log(`\n  ✓ 「AI 정제」에 ${fresh.length}줄 넣었다.`);
console.log('    이제 `fill-supplier-ai-columns --include-mirror --apply` → 발행 → ERP 동기 순으로 돌리면 정제칸부터 화면까지 따라온다.');
