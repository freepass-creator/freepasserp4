/** 오토플러스 헤더 합치기 — 두 갈래를 다 태워 본다. 읽기 전용 시뮬레이션. */
import { mergeAutoplusHeaderRows } from '@/lib/domain/sheet-adapters';
import { autoMapHeaders } from '@/lib/domain/sheet-import';

/* ① 판매시트 「오플구독」 탭 — 이름이 다 있다(2026-09-05 실측 그대로). */
const sales = ['배차상태','구분','차량번호','제조사','모델','세부모델','세부트림','외장','내장','연식','Km','연료','배기량','차종구분','보증금'];
/* ② 오토플러스 제공시트 — 6·7 이 이름 없이 온다(이 규칙이 원래 있던 이유). */
const supplier = ['상태','구분','차량번호','제조사','모델','세부모델','','','내장','연식','','연료','배기량','','보증금'];

for (const [name, head] of [['판매시트 오플구독', sales], ['공급사 제공시트', supplier]] as const) {
  const merged = mergeAutoplusHeaderRows(head as string[], []);
  const m = autoMapHeaders(merged);
  const at = (f: string) => (m[f] === undefined ? '(없음)' : `${m[f]} → ${merged[m[f]!] || '(빈칸)'}`);
  console.log(`\n■ ${name}`);
  console.log('  6·7 칸     ', JSON.stringify([merged[6], merged[7]]));
  console.log('  mileage    ', at('mileage'));
  console.log('  ext_color  ', at('ext_color'));
  console.log('  trim_name  ', at('trim_name'));
}
