/**
 * **공급사 원천 주소 대조 — 문패 ↔ partner.sheet_url ↔ 폐기 명단.** 읽기 전용 · 어긋나면 종료코드 1.
 *
 * ⚠ 2026-09-08 — 직접수집이 `partner.sheet_url` 을 원천으로 삼았는데 그 값이 **폐기된 옛 시트**였다.
 *   웰릭스가 24일 동안 죽은 시트를 읽어 K8 을 「모닝」으로 실었다. **주소가 틀리면 그 아래가 전부 틀어진다.**
 *   그런데 아무도 몰랐다 — 시트는 «읽혔고», 행도 «있었고», 게이트도 통과했기 때문이다.
 *   ⇒ 값을 검사하기 «전»에 **어디서 읽는지**를 검사한다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/audit-supplier-source.mts
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { listSheetTabs, readSheetGrid } from '../lib/server/google-sheets';
import { HUB_CODE_SHEET_ID, isLegacySheetId, LEGACY_SHEETS } from '../lib/domain/legacy-sheets';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';
import { hubSourceMap, sheetIdOf } from '../lib/domain/supplier-source';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
if (!S(process.env.GOOGLE_APPLICATION_CREDENTIALS)) process.env.GOOGLE_APPLICATION_CREDENTIALS = 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS), 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\n/g, '\n') }) });

const grid = await readSheetGrid(HUB_CODE_SHEET_ID, (await listSheetTabs(HUB_CODE_SHEET_ID))[0]);
const hub = hubSourceMap([grid.header, ...grid.rows]);
const mirror = new Map(MIRROR_SOURCES.map((m) => [m.code, m.from || m.kind]));
const dead = new Map(LEGACY_SHEETS.map((l) => [l.id, l]));
const partners = (await getFirestore().collection('partner').get()).docs.map((d) => d.data() as any);

const 죽은주소: string[] = [];
const 어긋남: string[] = [];
console.log(`문패 ${hub.size}곳 · partner ${partners.length}곳 · 폐기 명단 ${dead.size}개\n`);
console.log('  코드     이름          문패            partner.sheet_url');
for (const p of partners.sort((a, b) => S(a.partner_code).localeCompare(S(b.partner_code)))) {
  const code = S(p.partner_code).toUpperCase(); if (!code) continue;
  const h = hub.get(code) || '';
  const f = sheetIdOf(p.sheet_url);
  if (!h && !f) continue;
  const mark = (id: string) => (!id ? '—'.padEnd(12) : (isLegacySheetId(id) ? `⛔${id.slice(0, 10)}` : `  ${id.slice(0, 10)}`));
  console.log(`  ${code.padEnd(8)} ${S(p.name).slice(0, 12).padEnd(13)} ${mark(h)}  ${mark(f)}`);
  /** ★실제로 읽는 주소 = 문패 우선. 그것이 죽었으면 그 공급사는 통째로 틀어진다. */
  const used = h || f;
  if (isLegacySheetId(used)) 죽은주소.push(`${code} ${S(p.name)} — ${h ? '문패' : 'partner.sheet_url'} 이 폐기 시트(${dead.get(used)?.name || used} · ${dead.get(used)?.retiredOn || ''})`);
  /** partner.sheet_url 이 죽었어도 문패가 살아 있으면 «지금은» 안 읽는다 — 그래도 화면·사람이 보므로 알린다. */
  else if (f && isLegacySheetId(f)) 어긋남.push(`${code} ${S(p.name)} — partner.sheet_url 이 폐기 주소다(문패는 살아 있음). ERP 화면·사람이 그 주소를 본다`);
  else if (h && f && h !== f && !mirror.has(code)) 어긋남.push(`${code} ${S(p.name)} — 문패(${h.slice(0, 10)})와 partner.sheet_url(${f.slice(0, 10)})이 다르다`);
}

console.log('');
for (const x of 어긋남) console.log(`  ▲ ${x}`);
for (const x of 죽은주소) console.log(`  ⛔ ${x}`);
if (죽은주소.length) { console.log(`\n⛔ 죽은 원천 ${죽은주소.length}곳 — 그 공급사 값은 못 믿는다. 문패를 먼저 고쳐라.\n`); process.exit(1); }
console.log(`\n✓ 읽는 주소는 전부 살아 있다${어긋남.length ? ` — 알림 ${어긋남.length}건(사본이 늦음)` : ''}\n`);
process.exit(0);
