/**
 * **이 달 실적 확인을 «누가 누를 수 있나»** — 영업자별로 로그인이 있는지 센다.
 *
 * ★청구서가 「확인대기」로 막혀 있을 때, 그게 «길이 없어서»인지 «안 눌러서»인지를 가른다.
 *   2026-08-27 실측 — 9명 중 8명은 계정이 있었다. 막힌 게 아니라 아무도 안 누른 것이었다.
 *
 *   npx tsx scripts/check-confirm-reach.mts
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { normalizeRecord, type SettlementRecord } from '../lib/domain/settlement-record';
import { billingMonth, type SettlementRow } from '../lib/domain/settlement-stage';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const S = (v: unknown) => String(v ?? '').trim();
const K = (v: unknown) => S(v).toLowerCase().replace(/\s+/g, '');
const D = (v: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(v)); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };

const users = ((await db.ref('users').get()).val() || {}) as Record<string, Record<string, unknown>>;
const live = Object.values(users).filter((u) => !['deleted', 'rejected'].includes(S(u.status)));
const byName = new Set(live.map((u) => K(u.name)));
const byCode = new Set(live.map((u) => K(u.user_code)).filter(Boolean));

const rows = Object.values((await db.ref('v4/settlement_rows').get()).val() || {}).map((r) => normalizeRecord(r as SettlementRecord));
const asRow = (r: SettlementRecord) => ({ ...r, receivedAt: D(r.receivedAt), deliveredAt: D(r.deliveredAt), clawbackAt: D(r.clawbackAt) } as unknown as SettlementRow);
const aug = rows.filter((r) => !r.cancelled && billingMonth(asRow(r)) === '2026-08');

const agents = new Map<string, { n: number; ch: string }>();
for (const r of aug) {
  const a = S(r.agent) || '(빈칸)';
  const cur = agents.get(a) || { n: 0, ch: S(r.channel) };
  agents.set(a, { n: cur.n + 1, ch: cur.ch || S(r.channel) });
}
console.log('\n■ 2026-08 청구 대상 ' + aug.length + '건 · 영업자 ' + agents.size + '명\n');
let has = 0, no = 0;
for (const [a, v] of [...agents].sort((x, y) => y[1].n - x[1].n)) {
  const ok = byName.has(K(a)) || byCode.has(K(a));
  if (ok) has++; else no++;
  console.log('  ' + (ok ? '○' : '⛔') + ' ' + a.padEnd(12) + String(v.n).padStart(3) + '건  ' + v.ch.padEnd(8) + (ok ? '로그인 있음' : '로그인 없음 — 확인을 누를 사람이 없습니다'));
}
console.log('\n  로그인 있는 영업자 ' + has + '명 · 없는 영업자 ' + no + '명\n');
process.exit(0);
