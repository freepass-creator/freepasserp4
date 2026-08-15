/**
 * **차량번호를 표준형으로 규격화한다 — 차번은 이 파이프라인의 유일한 열쇠다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-15 — 「공급사가 입력한 차량번호를 차종마스터처럼 규격화해놔… 그게 필요함」)
 *   차종은 코드로 잡았는데 **정작 열쇠인 차번이 제각각이면** 조인이 흔들린다 —
 *   「12가 3456」과 「12가3456」은 같은 차인데 글자로는 다르다. 지금까지는 읽는 쪽마다
 *   공백을 떼며 버텼지만, 그건 도구마다 다시 하는 일이고 하나라도 빼먹으면 유령 차가 생긴다.
 *   **시트에 적힌 글자 자체를 표준형으로** 만들면 그 일이 통째로 없어진다.
 *
 * ★표준형 — 붙여 쓴 「12가3456」·「123가4567」(전국판) 또는 「서울31가1234」(옛 지역판).
 *   신차로 아직 번호가 없으면 차량번호는 **비우고** 차대번호 칸에 VIN 을 적는다(제공시트 규격).
 *
 * ★고치는 것과 안 고치는 것 — 선이 분명해야 안전하다.
 *   ○ 고친다   공백(전각 포함) 제거 · 전각 숫자→반각. **차의 정체가 안 바뀌는 표기만.**
 *   ✗ 안 고친다 「미정」·VIN·주석이 섞인 칸(「12가3456(대차)」) — 뜻이 실려 있어
 *              기계가 지우면 정보가 사라진다. 목록으로 보여 주고 사람이 정리한다.
 *
 * ★규격을 «앞으로도» 지키게 한다 — 차량번호 열에 **경고형 검증**을 단다(REGEXMATCH).
 *   막지는 않는다(strict:false) — 공급사 입력을 막으면 그 차가 아예 안 들어온다.
 *   틀린 표기에 경고 표식이 떠서 그 자리에서 보이게만 한다.
 *
 * ⚠ 규격화하다 같은 차번이 둘 되면 — 그건 **원래 같은 차가 두 줄** 있던 것이 표기 차이에
 *   가려져 있던 것이다. 대원칙 위반으로 크게 알린다. 자동으로 합치지 않는다.
 *
 *   npx tsx scripts/normalize-plates.mts
 *   npx tsx scripts/normalize-plates.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { companyAlias } from '../lib/domain/identity';
import { isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const DOC_NAME = arg('name', '프리패스 재고');
const REFINE = arg('refine', '1nLwfgBSCpN_GnFUw_2SbG5LdyB9-l6d9ObkMP3IGa5I');

/** 표준형 — 전국판 「12가3456」·「123가4567」, 옛 지역판 「서울31가1234」. */
const NATIONAL = /^\d{2,3}[가-힣]\d{4}$/;
const REGIONAL = /^[가-힣]{2}\d{1,2}[가-힣]\d{4}$/;
const isCanon = (v: string) => NATIONAL.test(v) || REGIONAL.test(v);
/** 표기만 정리 — 공백(전각 포함) 제거·전각 숫자 반각. 차의 정체는 안 바뀐다. */
const canon = (v: string) => v
  .replace(/[\s 　]+/g, '')
  .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;
const colA1 = (i: number) => { let s = ''; for (let n = i + 1; n > 0;) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));

/** 대상 — 우리 제공시트 전부 + 정제시트. 공급사 자체시트는 남의 문서라 안 건드린다. */
const targets: { id: string; who: string }[] = [];
{
  const files = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name contains '${DOC_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((files.files || []) as Rec[])) {
    const who = companyAlias(S(f.name).replace(DOC_NAME, '').trim()) || S(f.name).replace(DOC_NAME, '').trim();
    targets.push({ id: S(f.id), who });
  }
  targets.push({ id: REFINE, who: '정제시트' });
}

console.log(`\n■ 차량번호 규격화 ${APPLY ? '(반영)' : '(dry-run — 아직 안 쓴다)'} · 대상 ${targets.length}문서\n`);

let okN = 0, fixN = 0;
const fixes: string[] = [];
const oddities: string[] = [];      // 차번이 아닌 것 — 사람이 정리할 목록
const collisions: string[] = [];    // 규격화하면 같은 차번이 되는 줄 — 대원칙 위반
const writes: Map<string, { range: string; values: string[][] }[]> = new Map();
const validations: Map<string, Rec[]> = new Map();

for (const t of targets) {
  let meta: Rec;
  try { meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}?fields=${encodeURIComponent('sheets.properties(sheetId,title,gridProperties(rowCount))')}`); } catch { continue; }
  for (const sh of ((meta.sheets || []) as Rec[])) {
    const title = S(sh.properties?.title);
    if (isOurNonInventoryTab(title)) continue;
    let v: Rec;
    try { v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}/values/${encodeURIComponent(a1Tab(title))}`); } catch { continue; }
    const grid = ((v.values || []) as string[][]);
    const h = grid.findIndex((r) => r.some((c) => S(c) === '차량번호'));
    if (h < 0) continue;
    const pi = (grid[h] || []).map(S).indexOf('차량번호');
    const seen = new Map<string, number>();     // canon → 행번호
    for (let r = h + 1; r < grid.length; r++) {
      const raw = S((grid[r] || [])[pi]);
      if (!raw) continue;
      const c = canon(raw);
      if (isCanon(c)) {
        const prev = seen.get(c);
        if (prev) collisions.push(`${t.who}「${title}」 ${prev}행 ↔ ${r + 1}행 — 「${c}」가 표기만 다르게 두 줄`);
        else seen.set(c, r + 1);
        if (c === raw) { okN++; continue; }
        fixN++;
        if (fixes.length < 15) fixes.push(`${t.who}「${title}」${r + 1}행 「${raw}」 → 「${c}」`);
        const w = writes.get(t.id) || [];
        w.push({ range: `${a1Tab(title)}!${colA1(pi)}${r + 1}`, values: [[c]] });
        writes.set(t.id, w);
      } else {
        oddities.push(`${t.who}「${title}」${r + 1}행 「${raw.slice(0, 30)}」`);
      }
    }
    /**
     * 경고형 검증 — 차량번호 열에 «표준형 아니면 경고 표식». 막지는 않는다(strict:false).
     * ⚠ 수식은 그 열의 첫 데이터 칸을 기준으로 쓴다 — 상대 참조라 아래 칸에 자동으로 맞는다.
     */
    const rows = Number(sh.properties?.gridProperties?.rowCount) || grid.length + 100;
    const cell = `${colA1(pi)}${h + 2}`;
    const vv = validations.get(t.id) || [];
    vv.push({
      setDataValidation: {
        range: { sheetId: Number(sh.properties?.sheetId), startRowIndex: h + 1, endRowIndex: rows, startColumnIndex: pi, endColumnIndex: pi + 1 },
        rule: {
          condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=OR(ISBLANK(${cell}),REGEXMATCH(TO_TEXT(${cell}),"^\\d{2,3}[가-힣]\\d{4}$"),REGEXMATCH(TO_TEXT(${cell}),"^[가-힣]{2}\\d{1,2}[가-힣]\\d{4}$"))` }] },
          strict: false,
          inputMessage: '차량번호 표준형: 12가3456 (붙여서). 번호가 아직 없으면 비우고 차대번호 칸에 적어 주세요.',
        },
      },
    });
    validations.set(t.id, vv);
  }
}

console.log(`  표준형 그대로 ${okN}칸 · 표기만 고칠 것 ${fixN}칸 · 차번 아닌 것 ${oddities.length}칸`);
if (fixes.length) {
  console.log(`\n  ○ 고칠 것 (공백·전각 — 정체는 안 바뀐다)`);
  for (const f of fixes) console.log(`     ${f}`);
  if (fixN > fixes.length) console.log(`     … 그 밖 ${fixN - fixes.length}칸`);
}
if (oddities.length) {
  console.log(`\n  ▲ 차번이 아닌 것 — 기계가 안 고친다. 사람이 정리할 목록이다`);
  console.log(`     (신차라 번호가 없으면 차량번호를 비우고 차대번호 칸에 적는 것이 규격이다)`);
  for (const o of oddities.slice(0, 12)) console.log(`     ${o}`);
  if (oddities.length > 12) console.log(`     … 그 밖 ${oddities.length - 12}칸`);
}
if (collisions.length) {
  console.log(`\n  ⛔ 대원칙 위반이 표기에 가려져 있었다 — 같은 차가 두 줄이다`);
  for (const c of collisions) console.log(`     ${c}`);
}
if (!APPLY) { console.log('\n  미리보기였다. 실제로 쓰려면 --apply (경고형 검증도 같이 단다)\n'); process.exit(0); }

for (const [id, data] of writes) {
  for (let i = 0; i < data.length; i += 200) {
    await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
      method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: data.slice(i, i + 200) }),
    });
  }
}
/**
 * ⚠ 표(Table)가 덮은 열에는 검증을 못 단다 — API 가 「유형이 적용된 열」이라며 거절한다
 *   (실측 2026-08-15 · 제공시트 재고 탭이 그렇다). 그 탭은 건너뛰고 세어 보여 준다.
 *   값 규격화가 본체고 검증은 덤이다 — 덤이 안 된다고 본체까지 멈추면 안 된다.
 *   표가 덮은 탭은 표 자체가 드롭다운·형식을 관리하니 아주 맨몸도 아니다.
 */
let vOk = 0, vSkip = 0;
for (const [id, reqs] of validations) {
  for (const req of reqs) {
    try {
      await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [req] }) });
      vOk++;
    } catch { vSkip++; }
  }
}
console.log(`\n  반영 완료 — 표기 ${fixN}칸 고침 · 경고형 검증 ${vOk}열에 닮${vSkip ? ` · 표(Table)가 덮어 못 단 곳 ${vSkip}열` : ''}\n`);
