/**
 * **차종마스터에 «부합 안 되는» 매물을 원인별로 가른다. 쓰기 없음.**
 *
 * 차종마스터는 필수가 아니라 선택이다 — 차번·대여료만 있으면 매물로 등록된다(2026-08-06 결정).
 * 그래도 붙을 수 있는 건 붙여야 하니, 안 붙는 것을 «한 덩어리»로 두면 아무도 손을 못 댄다.
 * 처리 방법이 다르므로 원인별로 가른다:
 *
 *   A 원문에 차종이 없음   — 시트가 「기타」·공란. 우리가 풀 수 없다 → 공급사에 물어야 한다.
 *   B 마스터에 그 차가 없음 — 제조사·모델 자체가 마스터에 없다 → 마스터에 추가하면 붙는다.
 *   C 세대까지는 붙었는데 확신도 미달 — 트림·연식 신호가 모자란다 → 매처·시트 보완.
 *   D 트림이 다른 모델을 가리킴 — 「세부=K5인데 트림=K7…」 → 사람이 봐야 한다.
 *
 * 시트를 다시 읽지 않고 **지금 DB 에 있는 매물**을 지금 매처에 물려 본다 —
 * 반영 후에 남을 것이 무엇인지가 알고 싶은 것이기 때문이다.
 *
 *   npx tsx scripts/audit-master-misfit.mts
 *   npx tsx scripts/audit-master-misfit.mts --code=RP021
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { snapToMaster, type MasterEntry } from '../lib/domain/vehicle-master-match';
import { isListableProduct } from '../lib/domain/product';
import {
  buildMasterIndex, classifyMasterMisfit,
  MASTER_MISFIT_LABEL, MASTER_MISFIT_OWNER, type MasterMisfitKind,
} from '../lib/domain/master-misfit';
import type { EntityRecord } from '../lib/intake/entities';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '').toLowerCase();
const ONLY = (process.argv.find((a) => a.startsWith('--code=')) || '').slice('--code='.length).trim();

const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });

/** 「기타」·공란처럼 그 자체로 차종을 못 알려 주는 표기. */
const EMPTY_MODEL = /^(기타|미정|없음|-|없|기타차량)$/;

async function main() {
  const db = getDatabase();
  const master = (JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')).entries || []) as MasterEntry[];
  if (!master.length) throw new Error('차종마스터 로드 실패');
  const [p3, p4] = await Promise.all([db.ref('products').get(), db.ref('v4/products').get()]);
  const merged: Record<string, Rec> = {};
  for (const [k, v] of Object.entries((p3.val() || {}) as Record<string, Rec>)) merged[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((p4.val() || {}) as Record<string, Rec>)) merged[k] = { ...(merged[k] || {}), ...v, _key: k };
  const dead = (r: Rec) => r._deleted === true || !!r.deletedAt || S(r.status) === 'deleted';

  const index = buildMasterIndex(master);

  const rows = Object.values(merged)
    .filter((r) => !dead(r) && !r._merged_into && isListableProduct(r as EntityRecord))
    .filter((r) => !ONLY || S(r.provider_company_code) === ONLY);

  const buckets = new Map<MasterMisfitKind, Rec[]>();
  let fit = 0;

  for (const r of rows) {
    const res = snapToMaster(r as EntityRecord, master);
    const kind = classifyMasterMisfit(r as EntityRecord, index, res?.confidence);
    if (kind === 'fit') { fit++; continue; }
    buckets.set(kind, [...(buckets.get(kind) || []), r]);
  }

  console.log(`\n══ 차종마스터 부합 현황 ${ONLY ? `· ${ONLY}` : ''} (쓰기 없음) ══\n`);
  console.log(`  목록 매물 ${rows.length}대 · 마스터 부합 ${fit}대 · 부합 안 됨 ${rows.length - fit}대\n`);

  // 트림 확보율 — 부합 여부와 별개로 «어디까지 붙었나». 트림이 비면 손님에게 같은 차가
  // 여러 등급으로 뭉뚱그려 나가고, 확신도도 못 올라간다.
  const trimOf = (r: Rec) => S(r.trim_name) || S(r.variant);
  const noTrim = rows.filter((r) => !trimOf(r));
  console.log(`  트림 있음 ${rows.length - noTrim.length}대 · 트림 없음 ${noTrim.length}대`);
  if (noTrim.length) {
    const byProv = new Map<string, number>();
    for (const r of noTrim) byProv.set(S(r.provider_company_code) || '(미지정)', (byProv.get(S(r.provider_company_code) || '(미지정)') || 0) + 1);
    const worst = [...byProv.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 8);
    console.log(`     공급사별 트림 없음: ${worst.map(([c, n]) => `${c} ${n}`).join(' · ')}`);
  }
  console.log('');

  const ORDER: MasterMisfitKind[] = ['no_model', 'not_in_master', 'mis_snapped', 'trim_conflict', 'low_signal'];
  for (const b of ORDER) {
    const list = buckets.get(b) || [];
    if (!list.length) continue;
    console.log(`  ${MASTER_MISFIT_LABEL[b]}  ${list.length}대  [손볼 곳: ${MASTER_MISFIT_OWNER[b]}]`);
    // 같은 차종이 여러 대면 한 줄로 묶는다 — 손볼 단위는 «차» 가 아니라 «차종» 이다.
    const byModel = new Map<string, Rec[]>();
    for (const r of list) {
      const k = `${S(r.maker) || '(제조사없음)'} ${S(r.model) || '(차명없음)'} ${S(r.sub_model) || ''}`.trim();
      byModel.set(k, [...(byModel.get(k) || []), r]);
    }
    for (const [k, rs] of [...byModel.entries()].sort((a, b2) => b2[1].length - a[1].length)) {
      const plates = rs.map((r) => S(r.car_number)).filter(Boolean).slice(0, 3).join(', ');
      console.log(`     ${String(rs.length).padStart(3)}대  ${k.padEnd(28).slice(0, 28)}  ${plates}${rs.length > 3 ? ' …' : ''}`);
    }
    console.log('');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
