/**
 * **차번 열을 «값»으로 찾고, 그 위 헤더와 좌우 헤더를 같이 읽는다. 쓰기 없음.**
 *
 * 지금 매핑은 헤더 «이름»만 본다(autoMapHeaders). 이름이 낯설거나 비어 있으면 그 열은 통째로
 * 버려지고, 정작 차종을 정하는 글이 거기 있어도 못 쓴다.
 *
 * 그래서 사람이 시트를 볼 때 하는 순서를 그대로 따라 본다:
 *   ① 차번처럼 «생긴 값»이 모여 있는 열을 찾는다 — 이름이 아니라 값으로. 앵커다.
 *   ② 그 열의 헤더를 읽어 앵커가 맞는지 확인한다.
 *   ③ 좌우 열의 헤더와 값을 같이 읽어 각 칸의 의미를 정한다.
 *
 * 출력은 «차번 기준 상대 위치» 순서다 — 시트마다 열 순서가 달라도 같은 축으로 비교된다.
 * 이름이 없거나(무제) 이름과 값이 어긋나는 열이 곧 손볼 자리다.
 *
 *   npx tsx scripts/audit-sheet-columns.mts --code=RP021
 *   npx tsx scripts/audit-sheet-columns.mts            # 시트 있는 공급사 전체
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';
import { partnerSheetOpts, resolveAdapter } from '../lib/domain/sheet-adapters';
import { autoMapHeaders, parseMappingProfile } from '../lib/domain/sheet-import';
import { isExactRealPlate } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const ONLY = (process.argv.find((a) => a.startsWith('--code=')) || '').slice('--code='.length).trim();

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });

function parseCsv(t: string): string[][] {
  const rows: string[][] = []; let f = '', r: string[] = [], q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f); rows.push(r); r = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || r.length) { r.push(f); rows.push(r); }
  return rows;
}

/** 값이 무엇처럼 «생겼나» — 헤더 이름을 못 믿을 때 의미를 정하는 두 번째 근거. */
function kindOf(values: string[]): string {
  const v = values.filter(Boolean);
  if (!v.length) return '빈칸';
  const hit = (re: RegExp) => v.filter((x) => re.test(x)).length / v.length;
  if (hit(/^\d{2,3}[가-힣]\d{4}$/) > 0.5) return '차번';
  if (hit(/^(20)?\d{2}(년|년식|MY)?$/i) > 0.5) return '연식';
  if (hit(/가솔린|디젤|하이브리드|전기|LPG|LPI|EV|PHEV/i) > 0.4) return '연료';
  if (hit(/2WD|4WD|AWD|사륜|전륜|후륜|4MATIC|콰트로/i) > 0.3) return '구동';
  if (hit(/^\d{1,2}인승$/) > 0.3) return '인승';
  if (hit(/\d{4}[-./]\d{1,2}[-./]\d{1,2}/) > 0.4) return '날짜';
  if (hit(/km|킬로|만키로/i) > 0.3) return '주행';
  if (hit(/^\d{1,3}(,\d{3})+$/) > 0.5) return '금액';
  if (hit(/출고|판매|계약|보류|매각|재고확인/) > 0.4) return '상태';
  if (hit(/^[가-힣]{2,4}$/) > 0.6) return '짧은말';
  if (hit(/[가-힣A-Za-z]/) > 0.6) return '차종글';
  return '기타';
}

async function main() {
  const db = getDatabase();
  const [t3, t4] = await Promise.all([db.ref('partners').get(), db.ref('v4/partners').get()]);
  const partners: Record<string, Rec> = {};
  for (const [k, v] of Object.entries((t3.val() || {}) as Record<string, Rec>)) partners[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((t4.val() || {}) as Record<string, Rec>)) partners[k] = { ...(partners[k] || {}), ...v, _key: k };

  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await jwt.authorize();
  const token = (await jwt.getAccessToken()).token;

  console.log('\n══ 차번 앵커 + 헤더로 읽은 열 구성 (쓰기 없음) ══\n');

  for (const p of Object.values(partners)) {
    const code = S(p.partner_code) || S(p._key);
    if (ONLY && code !== ONLY) continue;
    if (!S(p.sheet_url) || p._deleted === true) continue;
    let o; try { o = partnerSheetOpts(p as EntityRecord); } catch { continue; }
    const id = (o.url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
    if (!id) continue;
    const adapter = resolveAdapter(p as EntityRecord);
    const meta = await (await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets(properties(sheetId,title))')}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )).json() as Rec;
    if (meta.error) continue;
    const tabs = o.gids.length ? o.gids : (meta.sheets || []).slice(0, 1).map((s: Rec) => String(s.properties?.sheetId ?? ''));

    for (const gid of tabs) {
      const title = meta.sheets?.find((s: Rec) => s.properties?.sheetId === Number(gid))?.properties?.title || gid;
      let rows: string[][] = [];
      try {
        const csv = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`, { redirect: 'follow' });
        if (!csv.ok) continue;
        rows = parseCsv(await csv.text());
      } catch { continue; }
      let table: string[][];
      try { table = adapter.prepareTable(rows, { headerRow: o.headerRow }); } catch { continue; }
      if (table.length < 2) continue;

      const headers = table[0].map(S);
      const body = table.slice(1);
      const colValues = (i: number) => body.map((r) => S(r[i])).filter(Boolean);

      // ① 차번 «값»이 가장 많이 모인 열 = 앵커. 헤더 이름은 안 본다.
      let anchor = -1, best = 0;
      for (let i = 0; i < headers.length; i++) {
        const vals = colValues(i);
        if (!vals.length) continue;
        const rate = vals.filter((x) => isExactRealPlate(x.replace(/\s/g, ''))).length / vals.length;
        if (rate > best) { best = rate; anchor = i; }
      }
      const saved = parseMappingProfile(p.mapping_profile);
      const mapping = saved && Object.keys(saved).length ? saved : autoMapHeaders(headers);
      const fieldByIdx = new Map<number, string>();
      for (const [f, i] of Object.entries(mapping)) if (typeof i === 'number') fieldByIdx.set(i, f);

      console.log(`  ${code.padEnd(9)} ${S(p.name || p.partner_name)} [${title}]`);
      if (anchor < 0 || best < 0.3) {
        console.log(`     ⚠ 차번 열을 값으로 못 찾음(최고 적중 ${Math.round(best * 100)}%) — 앵커 불가\n`);
        continue;
      }
      console.log(`     앵커 = ${anchor}열 「${headers[anchor] || '(무제)'}」 차번 적중 ${Math.round(best * 100)}%`);
      // ③ 좌우 — 차번 기준 -2 ~ +12칸까지, 값이 있는 열만.
      for (let i = Math.max(0, anchor - 2); i < Math.min(headers.length, anchor + 13); i++) {
        if (i === anchor) continue;
        const vals = colValues(i);
        if (vals.length < Math.max(2, body.length * 0.2)) continue;
        const off = i - anchor;
        const head = headers[i] || '(무제)';
        const kind = kindOf(vals);
        const field = fieldByIdx.get(i) || '—';
        // 헤더 이름이 없는데 차종 글이 들어 있는 열 = 지금 버려지는 정보.
        const flag = field === '—' && (kind === '차종글' || kind === '연료' || kind === '구동') ? '  ← 안 쓰는 차종 정보' : '';
        console.log(`       ${(off > 0 ? `+${off}` : `${off}`).padStart(3)}칸  ${head.padEnd(12).slice(0, 12)} ${kind.padEnd(5)} 매핑=${field.padEnd(16)} 예: ${vals.slice(0, 2).join(' / ').slice(0, 34)}${flag}`);
      }
      console.log('');
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
