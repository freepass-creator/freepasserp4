/**
 * **차종마스터에 채울 것 — 손오공** (읽기 전용, 시트 안 읽음)
 *
 * ★사장님 2026-09-01 커밋(`2c0f4c10`) — 「정제칸·상품리스트·ERP 가 새 이름을 만들면 안 된다.
 *   차종마스터의 한 행을 그대로 복사하는 길이어야 한다. **마스터를 고치기 전에는 비어 있는 것이 맞다**」.
 *   그래서 마스터에 없는 트림은 «비운다» — 이건 고장이 아니라 **마스터에 채울 게 있다는 신호**다.
 *   (2026-09-01 커버리지 217/217 → 141/215 로 내려간 것이 그 신호였다. 나는 처음에 이걸
 *    「망가졌다」로 읽고 되돌리자고 했다 — 오독이었다.)
 *
 *   이 자는 그 «채울 것»을 마스터에 붙여넣기 좋게 정리한다.
 *
 *   npx tsx scripts/report-master-todo-sonokong.mts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const REFINE = 'sonokong/tmp/손오공정제.json';
const MASTER = 'public/data/vehicle-master.json';

if (!existsSync(REFINE)) {
  console.error(`✗ ${REFINE} 이 없습니다 — 손오공 정제를 한 번 돌린 뒤에 부르세요.`);
  process.exit(1);
}
const refined = JSON.parse(readFileSync(REFINE, 'utf8')) as {
  결과: Array<Record<string, string>>;
  미스: { 모델없음: string[]; 트림연식없음: string[] };
};

/** 「140하9992 현대 팰리세이드 [트림 GL · 2021-05-18]」 를 조각낸다. */
const LINE = /^(\S+)\s+(\S+)\s+(.+?)\s+\[트림\s+(.*?)\s+·\s+(\S+)\]$/;
type Todo = { 차번: string; 제조사: string; 모델: string; 트림: string; 최초등록: string };
const todos: Todo[] = [];
for (const raw of refined.미스?.트림연식없음 ?? []) {
  const m = LINE.exec(String(raw).trim());
  if (!m) continue;
  todos.push({ 차번: m[1], 제조사: m[2], 모델: m[3], 트림: m[4], 최초등록: m[5] });
}

/** 라이브 차종마스터에 그 «모델»이 이미 있나 — 있으면 트림 한 줄만 보태면 된다. */
const masterModels = new Set<string>();
if (existsSync(MASTER)) {
  /* ★차종마스터 정본은 `{ entries: [...] }` 다. 처음에 `rows` 로 읽어 0행이 나왔고,
     그 바람에 «아반떼·셀토스·투싼»까지 「마스터에 없는 모델」로 찍혔다 —
     사장님이 그 표를 그대로 믿었으면 있는 차종을 새로 만들 뻔했다. */
  const book = JSON.parse(readFileSync(MASTER, 'utf8')) as { entries?: Record<string, unknown>[] };
  const rows = Array.isArray(book.entries) ? book.entries : [];
  if (!rows.length) {
    console.error('✗ 차종마스터를 못 읽었습니다 — 분류가 무의미하므로 멈춥니다.');
    process.exit(1);
  }
  for (const row of rows) {
    const maker = String(row.maker ?? '').trim();
    const model = String(row.model ?? '').trim();
    if (maker && model) masterModels.add(`${maker} ${model}`);
  }
}

/** 같은 «모델+트림»을 한 줄로 묶는다 — 마스터는 차 한 대가 아니라 «차종»을 담는 표다. */
const groups = new Map<string, { 제조사: string; 모델: string; 트림: string; 대수: number; 연식: Set<string>; 차번: string[] }>();
for (const t of todos) {
  const key = `${t.제조사}|${t.모델}|${t.트림}`;
  if (!groups.has(key)) groups.set(key, { 제조사: t.제조사, 모델: t.모델, 트림: t.트림, 대수: 0, 연식: new Set(), 차번: [] });
  const g = groups.get(key)!;
  g.대수 += 1;
  g.연식.add(t.최초등록.slice(0, 4));
  if (g.차번.length < 4) g.차번.push(t.차번);
}
const all = [...groups.values()].sort((a, b) => b.대수 - a.대수);
const 모델있음 = all.filter((g) => masterModels.has(`${g.제조사} ${g.모델}`));
const 모델없음 = all.filter((g) => !masterModels.has(`${g.제조사} ${g.모델}`));

const pad = (v: unknown, n: number) => String(v).padEnd(n);
const line = (g: typeof all[number]) =>
  `   ${pad(g.제조사, 5)} ${pad(g.모델, 14)} ${pad(g.트림, 14)} ${String(g.대수).padStart(3)}대  연식 ${[...g.연식].sort().join(',')}   ${g.차번.join(' ')}`;

console.log(`■ 차종마스터에 채울 것 — 손오공 ${todos.length}대 · ${all.length}가지 «모델+트림»`);
console.log('   (정제된 차 ' + refined.결과.length + '대는 정상. 아래는 마스터에 행이 없어 트림을 비운 것들이다)');

if (모델있음.length) {
  console.log(`\n■ ① 모델은 마스터에 있다 — **트림 한 줄만 보태면 된다** (${모델있음.length}가지)`);
  console.log(`   ${pad('제조사', 5)} ${pad('모델', 14)} ${pad('보탤 트림', 14)} 대수  연식        보기(차번)`);
  for (const g of 모델있음) console.log(line(g));
}
if (모델없음.length) {
  console.log(`\n■ ② 모델부터 마스터에 없다 — **행을 새로 만들어야 한다** (${모델없음.length}가지)`);
  console.log(`   ${pad('제조사', 5)} ${pad('모델', 14)} ${pad('트림', 14)} 대수  연식        보기(차번)`);
  for (const g of 모델없음) console.log(line(g));
}
if (refined.미스?.모델없음?.length) {
  console.log(`\n■ ③ 모델 자체를 못 찾은 차 ${refined.미스.모델없음.length}대`);
  for (const x of refined.미스.모델없음.slice(0, 10)) console.log(`   ${x}`);
}

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/master-todo-sonokong.json', JSON.stringify({ at: new Date().toISOString(), 총: todos.length, 묶음: all, todos }, null, 1));
console.log('\n기록 tmp/master-todo-sonokong.json · 여기서 고치지 않는다 — 채울 것을 보여만 준다');
