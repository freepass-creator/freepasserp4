/**
 * **B형 시트에 «차명 열이 없다» — 세부모델로 모델을 채우면 어떻게 되나. 쓰기 없음.**
 *
 * 종합시트(아이카·이안카)에는 `차종`(차명) 열이 없다. `세부모델`이 그 역할을 겸하는데
 * 매핑은 그걸 sub_model 로만 보내서 **model 이 빈 채로** 마스터에 붙는다.
 * 그 결과가 검수 24대(아이카 7 · 이안카 17)다.
 *
 * 후보 규칙: **model 이 비고 sub_model 이 있으면 sub_model 을 model 로도 쓴다.**
 * 모델 잠금을 건드리므로, 지금 잘 붙는 것이 틀어지지 않는지가 관건이다. 그래서 센다:
 *   ① 새로 붙음(검수 → 확정)  ② 틀어짐(확정 → 검수)  ③ 확정인데 다른 차로 바뀜
 *
 *   npx tsx scripts/sim-bform-model.mts
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';
import { partnerSheetOpts, resolveAdapter } from '../lib/domain/sheet-adapters';
import { importSheetTable, parseMappingProfile, parseMappingHeaderSignature, parseDepositRule } from '../lib/domain/sheet-import';
import { snapToMaster, type MasterEntry } from '../lib/domain/vehicle-master-match';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '').toLowerCase();
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

const fit = (c?: string) => c === 'high' || c === 'medium';
const rawOf = (p: Rec): Rec => {
  const raw = p._raw_vehicle;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Rec) } : { ...p };
};

async function main() {
  const db = getDatabase();
  const [t3, t4] = await Promise.all([db.ref('partners').get(), db.ref('v4/partners').get()]);
  const partners: Record<string, Rec> = {};
  for (const [k, v] of Object.entries((t3.val() || {}) as Record<string, Rec>)) partners[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((t4.val() || {}) as Record<string, Rec>)) partners[k] = { ...(partners[k] || {}), ...v, _key: k };

  const master = (JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')).entries || []) as MasterEntry[];
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await jwt.authorize();
  const token = (await jwt.getAccessToken()).token;

  const rows: Array<{ code: string; p: EntityRecord }> = [];
  for (const p of Object.values(partners)) {
    const code = S(p.partner_code) || S(p._key);
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
      let csvRows: string[][] = [];
      try {
        const csv = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`, { redirect: 'follow' });
        if (!csv.ok) continue;
        csvRows = parseCsv(await csv.text());
      } catch { continue; }
      let table: string[][];
      try { table = adapter.prepareTable(csvRows, { headerRow: o.headerRow }); } catch { continue; }
      if (table.length < 2) continue;
      const r = importSheetTable(table, {
        providerCode: code, entries: master,
        profile: parseMappingProfile(p.mapping_profile),
        profileHeaders: parseMappingHeaderSignature(p.mapping_header_signature),
        depositRule: parseDepositRule(p.deposit_rule),
      });
      for (const x of r.products) rows.push({ code, p: x });
    }
  }

  let target = 0, gained = 0, lost = 0, changed = 0, same = 0;
  const g: string[] = [], l: string[] = [], c: string[] = [];
  for (const { code, p } of rows) {
    const rec = p as Rec;
    const raw = rawOf(rec);
    // 후보가 건드리는 대상 = 원문에 차명이 없고 세부모델만 있는 행(=B형)
    if (S(raw.model) || !S(raw.sub_model)) continue;
    target++;
    const before = S(rec._snap_confidence);
    const cand = snapToMaster({ ...raw, model: S(raw.sub_model) } as EntityRecord, master);
    const after = S(cand?.confidence);
    const beforeCar = `${S(rec.maker)} ${S(rec.model)}`.trim();
    const afterCar = cand ? `${S(cand.maker)} ${S(cand.model)}`.trim() : '';
    const line = `${code} ${S(rec.car_number).padEnd(10)} 세부「${S(raw.sub_model).slice(0, 24)}」 ${beforeCar || '(없음)'} → ${afterCar || '(미매칭)'} [${before || '없음'}→${after || '없음'}]`;
    if (!fit(before) && fit(after)) { gained++; g.push(line); continue; }
    if (fit(before) && !fit(after)) { lost++; l.push(line); continue; }
    if (fit(before) && fit(after) && beforeCar && afterCar && norm(beforeCar) !== norm(afterCar)) { changed++; c.push(line); continue; }
    same++;
  }

  console.log('\n══ B형 «세부모델 → 모델» 규칙 전/후 (쓰기 없음) ══\n');
  console.log(`  유입 ${rows.length}대 · 규칙이 건드리는 것 ${target}대\n`);
  console.log(`  ✅ 새로 붙음   ${gained}대`);
  for (const x of g.slice(0, 15)) console.log(`       ${x}`);
  console.log(`\n  ⚠ 틀어짐      ${lost}대`);
  for (const x of l.slice(0, 15)) console.log(`       ${x}`);
  console.log(`\n  ⚠ 다른 차로   ${changed}대`);
  for (const x of c.slice(0, 15)) console.log(`       ${x}`);
  console.log(`\n  변화 없음 ${same}대\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
