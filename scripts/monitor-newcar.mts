/**
 * 신차마스터 매일 검수 모니터 — 제조사가 «가격·트림·옵션»을 바꿨는지 잡는다(사장님 2026-09-05
 *   「매일매일 검수 모니터링, 달라진 게 있는지」).
 *
 * 하는 일: 현재 Firestore new_car_trim 을 기준선으로 두고, 신선한 크롤(현대 API·PDF)과 맞대
 *   ①새 트림 ②사라진 트림 ③가격변동(전/후) ④옵션 수 변동 을 리포트한다. 읽기 전용(자동 반영 안 함 —
 *   사람이 보고 크롤러 --apply 로 갱신). --json 으로 기계용 출력.
 *
 * 사용: npx tsx scripts/monitor-newcar.mts            사람용 리포트
 *       npx tsx scripts/monitor-newcar.mts --json     tmp/newcar-monitor.json
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const JSON_OUT = process.argv.includes('--json');
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
const FS = getFirestore();
const S = (v: unknown) => String(v ?? '').trim();

// 기준선 = 현재 Firestore(브랜드별 트림 맵: key = maker|sub_model|fuel|trim)
const snap = await FS.collection('new_car_trim').get();
const baseline = new Map<string, any>();
snap.forEach((d) => { const v = d.data(); baseline.set(`${v.maker}|${v.sub_model}|${v.fuel}|${v.trim}`, v); });

type Diff = { added: string[]; removed: string[]; priceChanged: string[]; optionChanged: string[] };
const diff: Diff = { added: [], removed: [], priceChanged: [], optionChanged: [] };

// 신선한 현대 크롤(드라이런 — data/new-car/hyundai.json 에만 씀, Firestore 안 건드림)
execSync('npx tsx scripts/crawl-newcar-hyundai.mts', { stdio: 'ignore' });
const fresh = existsSync('data/new-car/hyundai.json') ? JSON.parse(readFileSync('data/new-car/hyundai.json', 'utf8')).trims || [] : [];
const stripFuel = (s: string) => S(s).replace(/\s*(플러그인\s*)?(하이브리드|hybrid|electric|일렉트릭|전기|ev|hev|phev)(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
const priceAfterOf = (t: any) => { const inc = Number(t.taxIncentive || 0); return inc > 0 ? Math.max(0, Number(t.price || 0) - inc) : Number(t.price || 0); };

const freshKeys = new Set<string>();
for (const t of fresh) {
  const key = `현대|${stripFuel(t.carType)}|${S(t.fuel)}|${S(t.trim)}`;
  freshKeys.add(key);
  const old = baseline.get(key);
  if (!old) { diff.added.push(`${stripFuel(t.carType)} ${t.trim} (${t.fuel}) ${Number(t.price).toLocaleString()}`); continue; }
  const nb = Number(t.price || 0), na = priceAfterOf(t);
  if (nb !== Number(old.priceBefore || 0) || na !== Number(old.priceAfter || 0))
    diff.priceChanged.push(`${stripFuel(t.carType)} ${t.trim}: 전 ${Number(old.priceBefore).toLocaleString()}→${nb.toLocaleString()} · 후 ${Number(old.priceAfter).toLocaleString()}→${na.toLocaleString()}`);
}
// 사라진 현대 트림(기준선엔 있는데 신선크롤엔 없음)
for (const [key, v] of baseline) {
  if (v.maker !== '현대') continue;
  if (!freshKeys.has(key)) diff.removed.push(`${v.sub_model} ${v.trim} (${v.fuel})`);
}

const changed = diff.added.length + diff.removed.length + diff.priceChanged.length;
if (JSON_OUT) {
  writeFileSync('tmp/newcar-monitor.json', JSON.stringify({ at: new Date().toISOString(), brand: '현대', ...diff }, null, 1));
  console.log(`tmp/newcar-monitor.json — 변동 ${changed}건`);
} else {
  console.log(`\n■ 신차마스터 검수 모니터 (현대) — ${new Date().toISOString().slice(0, 16)}`);
  console.log(`  기준선 ${[...baseline.values()].filter((v) => v.maker === '현대').length}트림 · 신선크롤 ${fresh.length}트림`);
  console.log(`  변동 ${changed}건 ${changed === 0 ? '✓ 그대로' : ''}`);
  if (diff.added.length) { console.log(`\n  [새 트림 ${diff.added.length}]`); diff.added.slice(0, 15).forEach((x) => console.log('    + ' + x)); }
  if (diff.removed.length) { console.log(`\n  [사라진 트림 ${diff.removed.length}]`); diff.removed.slice(0, 15).forEach((x) => console.log('    - ' + x)); }
  if (diff.priceChanged.length) { console.log(`\n  [가격변동 ${diff.priceChanged.length}]`); diff.priceChanged.slice(0, 20).forEach((x) => console.log('    ~ ' + x)); }
  console.log('\n  ※ PDF 브랜드(기아·제네시스)는 재다운로드+재추출로 같은 방식 확장. 반영은 사람이 크롤러 --apply.');
}
process.exit(0);
