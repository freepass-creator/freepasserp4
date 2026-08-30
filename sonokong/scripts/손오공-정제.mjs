/** 손오공 차량 → 공용 정제 엔진 호출. ★정제 «방법»은 여기 없다 — lib/차종정제.mjs 가 정본(모든 공급사 공용).
 *   이 파일은 손오공차량.json 을 읽어 엔진에 넘기고 결과를 찍는 «실행기»일 뿐이다.
 *
 *    node scripts/손오공-정제.mjs            미리보기(커버리지·미스)
 *    node scripts/손오공-정제.mjs --json      결과 JSON → tmp/손오공정제.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sheet } from '../lib/sheet.mjs';
import { 정제 } from '../lib/vehicle-refine.mjs';

const 루트 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MASTER = '1oMB9eoNnQFxUyRK4CSxYh_hKrtCf7s_79xLs-GYwXCE'; // 차종마스터_신규(탭: 차종마스터)
const jsonOut = process.argv.includes('--json');

async function main() {
  const 차량 = JSON.parse(fs.readFileSync(path.join(루트, 'lib/wonja/손오공차량.json'), 'utf8')).차량;
  const s = await sheet(MASTER);
  const cm = await s.values('차종마스터', 'A1:Z3000', 'FORMATTED_VALUE');

  const { 결과, 미스 } = 정제(차량, cm);

  console.log(`총 ${차량.length}대 · 매칭 ${결과.length} · 모델 시트에 없음 ${미스.모델없음.length} · 트림/연식 매칭실패 ${미스.트림연식없음.length}`);
  console.log('\n매칭 샘플:');
  for (const r of 결과.slice(0, 5)) console.log(`  ${r.차번} ${r.제조사} ${r.모델} → 세부모델 「${r.세부모델}」 · 세부트림 「${r.세부트림}」`);
  console.log('\n모델이 시트에 없음(시트에 추가 필요):', [...new Set(미스.모델없음.map((x) => x.split(' ').slice(1).join(' ')))].slice(0, 20).join(' · ') || '(없음)');
  console.log('\n트림/연식 매칭실패(샘플):'); 미스.트림연식없음.slice(0, 10).forEach((x) => console.log('  ' + x));

  if (jsonOut) {
    const p = path.join(루트, 'tmp', '손오공정제.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ 결과, 미스 }, null, 1));
    console.log('\n→ ' + p);
  }
}
main().catch((e) => { console.error('실패:', e.message); process.exit(1); });
