/**
 * 건물 점검 — 「십 층짜리 건물이면 문·창문은 다 같아야 한다」
 *
 * ★사장님 2026-08-30
 *   「올리고 나서 여기 고치고 저기 고치고 하다 보니까 너무 임기응변이 많은 거야.
 *    십 층짜리 건물을 지었으면 문은 다 동일해야 되고 창문 다 동일해야 되는 거지.
 *    근데 일 층은 로비니까 로비 뭐가 있는 거고 옥상은 옥상 나름 뭐가 있는 거잖아.」
 *
 * 이 검사기는 «새 규격»을 만들지 않는다. CLAUDE.md 에 이미 있는 규격을 **층 단위로 세어**
 * `docs/건물도면.md` 에 적힌 것과 대조할 뿐이다. 정본은 언제나 문서다.
 *
 *   docs/건물도면.md  = 도면 (사람이 읽는 정본 · 예외 근거가 여기 있다)
 *   이 스크립트        = 줄자 (도면과 실물이 같은지만 잰다)
 *
 * ★왜 «줄어도 빨간불»로 만들지 않았나
 *   check-ui-contract 는 raw 버튼이 14→0 으로 **좋아졌는데도** 빨간불이 떴다(2026-08-29).
 *   좋아진 것까지 빨갛게 뜨면 아무도 그 불을 안 믿는다. 그래서 여기서는:
 *     늘었다 → ✗ 실패 (새로 낸 구멍)
 *     줄었다 → ✓ 통과 + 「도면을 N 으로 낮추세요」 안내 (--tighten 이면 문서를 자동으로 고친다)
 *   래칫(한 방향 조임)이라 도면은 실물보다 느슨해질 수는 있어도 «거짓말»은 못 한다.
 *
 * 쓰기:
 *   npx tsx scripts/check-building.mts            점검
 *   npx tsx scripts/check-building.mts --census    실측표만 출력(도면에 붙일 원자료)
 *   npx tsx scripts/check-building.mts --tighten   좋아진 만큼 도면을 자동으로 조인다
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { floors, rooms, measureTarget, ROOT, type Measured } from './lib/building-census.mts';

const PLAN = join(ROOT, 'docs/건물도면.md');
const MODE_CENSUS = process.argv.includes('--census');
const MODE_TIGHTEN = process.argv.includes('--tighten');

/** 동(棟) — 층마다 «어느 규격을 따르는가». 로비와 옥상이 달라도 되는 근거가 여기 있다. */
const WINGS: Record<string, { label: string; shell: RegExp | null; note: string }> = {
  업무: { label: 'ERP 업무동', shell: /^(Page|WorkPage)$/, note: 'CLAUDE.md 원자 사전 · 껍데기는 Page/WorkPage' },
  로비: { label: '로비(진입)', shell: null, note: '앱 셸 이전 또는 매물 첫 화면 — 껍데기 예외를 도면에 적는다' },
  손님: { label: '손님동', shell: null, note: '착한거래 규격(docs/ESIGN-UIUX-SPEC.md) — ERP 얼굴을 쓰지 않는다' },
  별관: { label: '별관(임베디드)', shell: /^EmbeddedApp$/, note: '남의 브랜드를 담는 액자 — EmbeddedApp 만 쓴다' },
  신관: { label: '신관(공사중)', shell: null, note: 'erp5 — 완공 전까지 규격 유예. 기한을 도면에 적는다' },
  기계실: { label: '기계실(개발·진단)', shell: null, note: '손님이 안 보는 곳. 원자만 쓰면 된다' },
};

type Row = {
  key: string;          // 층 이름(라우트) 또는 부속실 파일 경로
  wing: string;
  what: string;
  shell: string;
  raw: number;
  height: number;
  checker: string;
  line: number;         // 도면에서 이 행이 있던 줄 번호
};

// ── 도면 읽기 ───────────────────────────────────────────────────────────────

/**
 * 도면의 표를 읽는다. 마커 사이만 본다 — 문서에 설명 표를 더 써도 안 깨지게.
 *   <!-- 도면:층 --> ... <!-- /도면:층 -->
 */
function readTable(marker: string, lines: string[]): Row[] {
  const start = lines.findIndex((line) => line.trim() === `<!-- 도면:${marker} -->`);
  const end = lines.findIndex((line) => line.trim() === `<!-- /도면:${marker} -->`);
  if (start < 0 || end < 0) throw new Error(`docs/건물도면.md 에 <!-- 도면:${marker} --> 구간이 없습니다`);
  const rows: Row[] = [];
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index];
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 7) continue;
    if (/^-+$/.test(cells[0].replace(/[: ]/g, '')) || cells[0] === '층' || cells[0] === '부속실') continue;
    const num = (value: string) => {
      const parsed = Number(value.replace(/[^0-9]/g, ''));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    rows.push({
      key: cells[0].replace(/`/g, ''),
      wing: cells[1],
      what: cells[2],
      shell: cells[3].replace(/`/g, ''),
      raw: num(cells[4]),
      height: num(cells[5]),
      checker: cells[6],
      line: index,
    });
  }
  return rows;
}

// ── 대조 ────────────────────────────────────────────────────────────────────

const problems: string[] = [];
const loosened: Array<{ line: number; column: 'raw' | 'height'; from: number; to: number; key: string }> = [];

function compare(kind: '층' | '부속실', drawn: Row[], measured: Map<string, Measured>) {
  const drawnKeys = new Set(drawn.map((row) => row.key));

  for (const [key] of measured) {
    if (!drawnKeys.has(key)) {
      problems.push(`${kind} «${key}» 이 도면에 없습니다 — docs/건물도면.md 에 등록하세요(무엇을 하는 곳인지·어느 동인지)`);
    }
  }

  for (const row of drawn) {
    const actual = measured.get(row.key);
    if (!actual) {
      problems.push(`${kind} «${row.key}» 은 도면에만 있고 실물이 없습니다 — 헐었으면 도면에서도 지웁니다`);
      continue;
    }

    const wing = WINGS[row.wing];
    if (!wing) {
      problems.push(`${kind} «${row.key}» 의 동 «${row.wing}» 은 없는 동입니다 (${Object.keys(WINGS).join('·')})`);
      continue;
    }

    /* 껍데기 칸의 별표(`없음*`)는 «이 층은 껍데기가 없어도 되는 이유가 「무엇」 칸에 적혀 있다»는 표시다.
       별표 없이 껍데기가 빠지면 그건 임기응변이다. */
    const shellExempt = row.shell.endsWith('*');
    const drawnShell = row.shell.replace(/\*$/, '');
    if (kind === '부속실') {
      /* 부속실은 스스로 껍데기를 쓰지 않는다 — 층이 씌운 껍데기 «안»에 들어가는 방이다. */
    } else if (drawnShell !== '-' && drawnShell !== actual.shell) {
      problems.push(`${kind} «${row.key}»: 껍데기가 도면과 다릅니다 — 도면 ${drawnShell} / 실물 ${actual.shell}`);
    } else if (wing.shell && !wing.shell.test(actual.shell) && !shellExempt) {
      problems.push(
        `${kind} «${row.key}»: ${wing.label} 인데 껍데기가 «${actual.shell}» 입니다 — ${wing.note}`
        + ` (정말 예외면 도면 껍데기 칸에 별표를 달고 「무엇」 칸에 근거를 적으세요)`,
      );
    }

    for (const column of ['raw', 'height'] as const) {
      const name = column === 'raw' ? 'raw 컨트롤' : '하드코딩 높이';
      if (actual[column] > row[column]) {
        problems.push(
          `${kind} «${row.key}»: ${name} ${row[column]} → ${actual[column]} 로 늘었습니다`
          + ` — 원자를 쓰거나, 정말 필요하면 도면에 근거를 적고 숫자를 올리세요`,
        );
      } else if (actual[column] < row[column]) {
        loosened.push({ line: row.line, column, from: row[column], to: actual[column], key: row.key });
      }
    }
  }
}

// ── 실행 ────────────────────────────────────────────────────────────────────

const measuredFloors = floors();
const measuredRooms = rooms();

if (MODE_CENSUS) {
  console.log('<!-- 도면:층 -->');
  console.log('| 층 | 동 | 무엇을 하는 곳 | 껍데기 | raw | 높이 | 검사기 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const [route, m] of [...measuredFloors].sort()) {
    console.log(`| \`${route}\` | ? | ? | ${m.shell} | ${m.raw} | ${m.height} | - |`);
  }
  console.log('<!-- /도면:층 -->');
  console.log('');
  console.log('<!-- 도면:부속실 -->');
  console.log('| 부속실 | 동 | 무엇을 하는 곳 | 껍데기 | raw | 높이 | 검사기 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const [file, m] of [...measuredRooms].sort()) {
    console.log(`| \`${file}\` | ? | ? | - | ${m.raw} | ${m.height} | - |`);
  }
  console.log('<!-- /도면:부속실 -->');
  process.exit(0);
}

if (!existsSync(PLAN)) {
  console.error('✗ docs/건물도면.md 가 없습니다. `npx tsx scripts/check-building.mts --census` 로 초안을 뽑으세요.');
  process.exit(1);
}

const planSource = readFileSync(PLAN, 'utf8');
const planEol = planSource.includes('\r\n') ? '\r\n' : '\n'; // --tighten 이 줄바꿈을 통째로 바꾸지 않게
const planLines = planSource.split(/\r?\n/);
const drawnRooms = readTable('부속실', planLines);

/* 부속실이 0/0 이 되면 «깨끗해진 것»이지 «헐린 것»이 아니다. 도면에 적힌 방은 깨끗해도 계속 잰다
   — 안 그러면 다 고친 방이 「실물이 없습니다」로 뜬다(2026-08-30 실제로 5개가 그랬다). */
for (const row of drawnRooms) {
  if (measuredRooms.has(row.key)) continue;
  const measured = measureTarget(row.key);
  if (measured) measuredRooms.set(row.key, measured);
}

compare('층', readTable('층', planLines), measuredFloors);
compare('부속실', drawnRooms, measuredRooms);

if (MODE_TIGHTEN && loosened.length) {
  for (const item of loosened) {
    const cells = planLines[item.line].split('|');
    const at = item.column === 'raw' ? 5 : 6; // | key | wing | what | shell | raw | height | checker |
    cells[at] = ` ${item.to} `;
    planLines[item.line] = cells.join('|');
  }
  writeFileSync(PLAN, planLines.join(planEol), 'utf8');
  console.log(`✓ 도면을 ${loosened.length}칸 조였습니다 — 좋아진 만큼 문서를 낮췄습니다.`);
}

if (problems.length) {
  console.error(`✗ 건물이 도면과 다릅니다 — ${problems.length}건\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('\n  도면: docs/건물도면.md');
  process.exit(1);
}

const totalRaw = [...measuredFloors.values(), ...measuredRooms.values()].reduce((sum, m) => sum + m.raw, 0);
const totalHeight = [...measuredFloors.values(), ...measuredRooms.values()].reduce((sum, m) => sum + m.height, 0);
console.log(`✓ 건물이 도면대로입니다 — 층 ${measuredFloors.size} · 부속실 ${measuredRooms.size}`);
console.log(`  남은 임기응변: raw 컨트롤 ${totalRaw} · 하드코딩 높이 ${totalHeight}`);
if (loosened.length && !MODE_TIGHTEN) {
  console.log(`\n  ↓ ${loosened.length}칸이 도면보다 좋아졌습니다. \`--tighten\` 으로 도면을 낮추세요:`);
  for (const item of loosened.slice(0, 12)) {
    console.log(`    ${item.key} ${item.column === 'raw' ? 'raw' : '높이'} ${item.from} → ${item.to}`);
  }
}
