/**
 * **서버 투영이 판정을 바꾸지 않는가 — 완전 레코드와 결과를 대조한다. 쓰기 없음.**
 *
 * 검증용 재고 스냅샷을 브라우저 전량 읽기에서 서버 투영으로 옮겼다
 * (lib/server/sheet-reconcile-state.ts). 필드를 줄였으므로 «판정이 같다»를 증명해야 한다.
 *
 * 특히 위험한 건 크기가 아니라 **유령 diff** 다. `softMergeProduct`·`changedPatch` 는
 * «incoming 키»를 돌며 prev 와 비교하므로(sheet-merge.ts:104-158), 시트가 가질 수 있는 필드를
 * 하나라도 빼면 `same(undefined, v)=false` 가 되어 전 건이 «내용수정»으로 부풀고
 * 커밋 사후검증이 영구 실패한다. 그 사고를 여기서 미리 잡는다.
 *
 * 같은 유입에 대해 (A) 완전 레코드 · (B) 투영 레코드로 각각 판정을 돌려 숫자를 맞춰 본다.
 *
 *   npx tsx scripts/sim-reconcile-projection.mts
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';
import { partnerSheetOpts, resolveAdapter } from '../lib/domain/sheet-adapters';
import { importSheetTable, parseMappingProfile, parseMappingHeaderSignature, parseDepositRule } from '../lib/domain/sheet-import';
import { planProductUpsert, planAbsentBlocked } from '../lib/domain/sheet-merge';
import { summarizeSheetDiff } from '../lib/domain/sheet-diff';
import type { MasterEntry } from '../lib/domain/vehicle-master-match';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });

/** 서버 모듈은 'server-only' 라 못 부른다 — 화이트리스트만 소스에서 그대로 읽어 쓴다. */
function whitelist(name: string): string[] {
  const src = readFileSync('lib/server/sheet-reconcile-state.ts', 'utf8');
  const start = src.indexOf(`${name} = [`);
  const end = src.indexOf('] as const', start);
  if (start < 0 || end < 0) throw new Error(`${name} 을 찾지 못했다 — 서버 모듈 구조가 바뀌었나`);
  // ⚠ 콤마로 쪼개면 안 된다 — 목록에 주석 줄이 섞여 있어 «주석 다음 첫 필드»가 통째로 빠진다.
  //   그 상태로 대조하면 vehicle_status·price 같은 핵심 필드가 없는 가짜 투영이 되어
  //   「판정이 달라진다」는 거짓 경보가 난다(실제로 한 번 속았다). 따옴표만 뽑는다.
  const block = src.slice(start + name.length + 4, end);
  const found = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (!found.length) throw new Error(`${name} 항목을 못 읽었다`);
  return found;
}

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

const project = (record: Rec, fields: string[]): EntityRecord => {
  const out: Rec = {};
  for (const field of fields) if (record[field] !== undefined) out[field] = record[field];
  out._full_digest = 'stub';
  return out as EntityRecord;
};

async function main() {
  const db = getDatabase();
  const activeFields = whitelist('SHEET_RECONCILE_ACTIVE_FIELDS');
  const deletedFields = whitelist('SHEET_RECONCILE_DELETED_FIELDS');

  const [t3, t4, snap] = await Promise.all([
    db.ref('partners').get(), db.ref('v4/partners').get(), db.ref('v4/products').get(),
  ]);
  const partners: Record<string, Rec> = {};
  for (const [k, v] of Object.entries((t3.val() || {}) as Record<string, Rec>)) partners[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((t4.val() || {}) as Record<string, Rec>)) partners[k] = { ...(partners[k] || {}), ...v, _key: k };

  const raw = (snap.val() || {}) as Record<string, Rec>;
  const dead = (r: Rec) => r._deleted === true || Boolean(r.deletedAt) || S(r.status) === 'deleted';
  const fullActive: EntityRecord[] = [];
  const projActive: EntityRecord[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const record = { ...value, _key: key, product_code: value.product_code || key };
    if (dead(record)) continue;
    fullActive.push(record as EntityRecord);
    projActive.push(project(record, activeFields));
  }

  // 유입 — 실제 경로 그대로
  const master = (JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')).entries || []) as MasterEntry[];
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await jwt.authorize();
  const token = (await jwt.getAccessToken()).token;

  const byProvider = new Map<string, EntityRecord[]>();
  for (const p of Object.values(partners)) {
    const code = S(p.partner_code) || S(p._key);
    if (!S(p.sheet_url) || p._deleted === true) continue;
    let o; try { o = partnerSheetOpts(p as EntityRecord); } catch { continue; }
    const id = (o.url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
    if (!id) continue;
    const adapter = resolveAdapter(p as EntityRecord);
    const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets(properties(sheetId,title))')}`, { headers: { Authorization: `Bearer ${token}` } })).json() as Rec;
    if (meta.error) continue;
    const tabs = o.gids.length ? o.gids : (meta.sheets || []).slice(0, 1).map((s: Rec) => String(s.properties?.sheetId ?? ''));
    for (const gid of tabs) {
      let rows: string[][] = [];
      try {
        const csv = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`, { redirect: 'follow' });
        if (!csv.ok) continue;
        rows = parseCsv(await csv.text());
      } catch { continue; }
      let table: string[][];
      try { table = adapter.prepareTable(rows, { headerRow: o.headerRow }); } catch { continue; }
      if (table.length < 2) continue;
      const r = importSheetTable(table, {
        providerCode: code, entries: master,
        profile: parseMappingProfile(p.mapping_profile),
        profileHeaders: parseMappingHeaderSignature(p.mapping_header_signature),
        depositRule: parseDepositRule(p.deposit_rule),
      });
      byProvider.set(code, [...(byProvider.get(code) || []), ...r.products]);
    }
  }

  console.log('\n══ 서버 투영이 판정을 바꾸는가 (쓰기 없음) ══\n');
  console.log(`  활성 ${fullActive.length}건 · 화이트리스트 활성 ${activeFields.length}필드 / 삭제 ${deletedFields.length}필드\n`);
  console.log('  공급사        신규(완전/투영)  수정(완전/투영)  무변경(완전/투영)  부재(완전/투영)');

  let bad = 0;
  for (const [code, incoming] of [...byProvider.entries()].sort()) {
    const a = planProductUpsert(incoming, fullActive);
    const b = planProductUpsert(incoming, projActive);
    const da = summarizeSheetDiff({ incoming, existing: fullActive, providerCode: code });
    const dbb = summarizeSheetDiff({ incoming, existing: projActive, providerCode: code });
    const presentKeys = new Set(incoming.map((x) => S((x as Rec).product_code) || S((x as Rec)._key)).filter(Boolean));
    const presentPlates = new Set(incoming.map((x) => S((x as Rec).car_number).replace(/\s/g, '')).filter(Boolean));
    const absA = planAbsentBlocked({ existing: fullActive, providerCode: code, presentKeys, presentPlates });
    const absB = planAbsentBlocked({ existing: projActive, providerCode: code, presentKeys, presentPlates });

    const same = a.creates.length === b.creates.length
      && a.patches.length === b.patches.length
      && (a.unchanged ?? -1) === (b.unchanged ?? -2)
      && da.new === dbb.new && da.status === dbb.status && da.content === dbb.content && da.absent === dbb.absent
      && absA.patches.length === absB.patches.length;
    if (!same) bad++;
    console.log(`  ${same ? '✅' : '❌'} ${code.padEnd(10)} ${String(a.creates.length).padStart(4)}/${String(b.creates.length).padEnd(4)} ${String(a.patches.length).padStart(6)}/${String(b.patches.length).padEnd(5)} ${String(a.unchanged ?? 0).padStart(6)}/${String(b.unchanged ?? 0).padEnd(6)} ${String(absA.patches.length).padStart(5)}/${String(absB.patches.length)}`);
    if (!same) {
      // 어느 차가 달라졌는지 — 숫자만 보면 원인을 못 찾는다.
      const keyOf = (x: Rec) => S(x.key);
      const onlyB = b.patches.filter((x) => !a.patches.some((y) => keyOf(y) === keyOf(x))).slice(0, 5);
      for (const x of onlyB) console.log(`        ← 투영에서만 «수정»으로 잡힘: ${S((x as Rec).key)} · ${Object.keys((x as Rec).patch || {}).slice(0, 6).join(', ')}`);
    }
  }

  console.log(`\n  ${bad ? `❌ 판정이 달라진 공급사 ${bad}곳 — 화이트리스트에 빠진 필드가 있다` : '✅ 전 공급사에서 판정 동일 — 투영이 안전하다'}\n`);
  if (bad) process.exitCode = 1;
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1); });
