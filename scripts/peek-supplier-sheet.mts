/**
 * 공급사 시트 헤더·표본행 실측 — 「제조사」 칸이 있는지, 무엇이 들어 있는지. 읽기 전용.
 *
 * 미확정 매물의 제조사가 엉뚱한 값(아우디 K5)인 원인을 시트 원문에서 확인한다.
 * 헤더가 sheet-import 의 별칭에 걸리는지도 함께 표시한다 — 안 걸리면 그 칸은 «무시»된다.
 *
 *   npx tsx scripts/peek-supplier-sheet.mts --code=RP021
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';
import { HEADER_ALIASES } from '../lib/domain/sheet-import';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');
const col = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });

async function main() {
  const code = (process.argv.find((a) => a.startsWith('--code=')) || '').split('=')[1] || '';
  if (!code) { console.log('--code=RP021 필요'); return; }

  const db = getDatabase();
  const live = ((await db.ref('partners').get()).val() || {}) as Record<string, Rec>;
  const over = ((await db.ref('v4/partners').get()).val() || {}) as Record<string, Rec>;
  const merged: Record<string, Rec> = {};
  for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) merged[k] = { ...(live[k] || {}), ...(over[k] || {}) };
  const p = Object.values(merged).find((x) => S(x.partner_code) === code);
  if (!p) { console.log(`${code} 파트너 없음`); return; }

  const url = S(p.sheet_url);
  const id = (url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || [])[1];
  console.log(`\n■ ${code} ${S(p.partner_name || p.company_name)}`);
  console.log(`   sheet_tab 설정 「${S(p.sheet_tab) || '(없음)'}」 · header_row ${S(p.header_row) || '(없음)'} · mapping_profile ${S(p.mapping_profile) ? '있음' : '없음'}`);
  if (S(p.mapping_profile)) console.log(`   mapping_profile = ${S(p.mapping_profile).slice(0, 300)}`);
  if (!id) { console.log('   sheet_url 없음'); return; }

  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await jwt.authorize();
  const token = (await jwt.getAccessToken()).token;
  const api = async (path: string) => {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
    return r.json() as Promise<any>;
  };

  const meta = await api(`${id}?fields=sheets.properties.title`);
  const tabs: string[] = meta.sheets.map((s: any) => s.properties.title);
  console.log(`   탭 ${tabs.length}개: ${tabs.join(' · ')}\n`);

  for (const t of tabs) {
    const v = await api(`${id}/values/${encodeURIComponent(`${t}!A1:AZ12`)}`).catch(() => null);
    const rows: string[][] = v?.values || [];
    if (!rows.length) { console.log(`   「${t}」 빈 탭\n`); continue; }
    // 별칭 적중이 가장 많은 행 = 헤더
    let best = 0, hits = -1;
    rows.forEach((r, i) => {
      const h = r.filter((c) => (HEADER_ALIASES as Rec)[norm(c)]).length;
      if (h > hits) { hits = h; best = i; }
    });
    const hdr = rows[best] || [];
    console.log(`   ▸ 「${t}」 헤더=${best + 1}행 (별칭 적중 ${hits}칸)`);
    const makerCols: number[] = [];
    hdr.forEach((c, i) => {
      const raw = S(c);
      if (!raw) return;
      const mapped = (HEADER_ALIASES as Rec)[norm(raw)];
      if (mapped === 'maker') makerCols.push(i);
      console.log(`        ${col(i).padEnd(3)} ${raw.padEnd(14)} ${mapped ? `→ ${mapped}` : '→ (무시)'}`);
    });
    if (!makerCols.length) {
      console.log(`        ❌ 제조사(maker)로 매핑되는 칸이 없다`);
    } else {
      const body = rows.slice(best + 1, best + 6);
      for (const mc of makerCols) {
        const vals = body.map((r) => S(r[mc]) || '(빈칸)');
        console.log(`        ✓ 제조사 칸 ${col(mc)} 표본: ${vals.join(' / ')}`);
      }
    }
    console.log('');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
