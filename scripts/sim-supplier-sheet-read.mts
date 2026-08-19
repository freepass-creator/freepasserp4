/**
 * **공급사 시트 읽기 규격 sim.** 네트워크 없이 도는 순수 검증.
 *
 * `lib/domain/supplier-sheet-read.ts` 의 네 가지 규칙이 살아 있는지 본다.
 * 하나라도 깨지면 재고 대수가 조용히 틀어진다 — 2026-08-10 에 실제로 그랬다.
 *
 *   npx tsx scripts/sim-supplier-sheet-read.mts
 */
import { readFileSync } from 'node:fs';
import {
  SHEET_GRID_FIELDS, findPlateAndStatusColumns, isRetryableSheetsReadFailure,
  readSupplierSheet, sheetIdFromUrl,
} from '../lib/domain/supplier-sheet-read';
import type { SheetsGridResponse } from '../lib/domain/sheet-visible-grid';
import type { EntityRecord } from '../lib/intake/entities';

let pass = 0; let fail = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

/** 격자 응답 흉내 — `formattedValue` 와 `rowMetadata` 구조가 실물과 같아야 한다. */
const cell = (v: string) => ({ formattedValue: v });
const row = (...vs: string[]) => ({ values: vs.map(cell) });
const tab = (id: number, title: string, rows: string[][], opts: { hidden?: boolean; hiddenRows?: number[] } = {}) => ({
  properties: { sheetId: id, title, hidden: opts.hidden || undefined },
  data: [{
    rowMetadata: rows.map((_, i) => ({ hiddenByUser: (opts.hiddenRows || []).includes(i) || undefined })),
    rowData: rows.map((r) => row(...r)),
  }],
});
const partner = (extra: Record<string, unknown> = {}) => ({ partner_code: 'RP999', ...extra } as EntityRecord);

const HEAD = ['배차상태', '차량번호', '차종', '12개월'];
const CAR = (n: string) => ['출고가능', n, '아반떼', '500,000'];

console.log('■ 공급사 시트 읽기 규격\n');

// ── ① 숨긴 행은 없는 행이다 ────────────────────────────────────────
{
  const grid = { sheets: [tab(0, '재고', [HEAD, CAR('01가1111'), CAR('02나2222')], { hiddenRows: [2] })] } as unknown as SheetsGridResponse;
  const { tabs } = readSupplierSheet(grid, partner());
  const plates = tabs[0].table.slice(1).map((r) => r[1]);
  ok('① 숨긴 행은 안 읽는다', plates.length === 1 && plates[0] === '01가1111', `읽힌 차 ${plates.join(',')}`);
  ok('① 숨긴 행 수를 알려준다', tabs[0].hiddenRows === 1, `hiddenRows=${tabs[0].hiddenRows}`);
}

// ── ② 숨긴 탭도 없는 탭이다 ────────────────────────────────────────
{
  const grid = {
    sheets: [
      tab(0, '재고', [HEAD, CAR('01가1111')]),
      tab(1, '옛 재고', [HEAD, CAR('99하9999')], { hidden: true }),
    ],
  } as unknown as SheetsGridResponse;
  const { tabs } = readSupplierSheet(grid, partner());
  ok('② 숨긴 탭은 안 읽는다', tabs.length === 1 && tabs[0].title === '재고', `읽힌 탭 ${tabs.map((t) => t.title).join(',')}`);
}

// ── ③ sheet_tab 은 gid 여러 개 ────────────────────────────────────
{
  const grid = {
    sheets: [
      tab(0, '가', [HEAD, CAR('01가1111')]),
      tab(1718488412, '나', [HEAD, CAR('02나2222')]),
      tab(777, '다', [HEAD, CAR('03다3333')]),
    ],
  } as unknown as SheetsGridResponse;
  const { tabs } = readSupplierSheet(grid, partner({ sheet_tab: '0,1718488412' }));
  ok('③ gid 를 쉼표로 여러 개 지정할 수 있다', tabs.length === 2 && tabs.map((t) => t.title).join(',') === '가,나',
    `읽힌 탭 ${tabs.map((t) => t.title).join(',')}`);
}
{
  /**
   * 지정한 탭이 «숨김»이면 그래도 안 읽는다 — 도메인이 아예 막는다
   * (`visibleRowsFromGridResponse`: 「숨김 탭은 연동할 수 없습니다」).
   * 숨겼다는 건 공급사가 안 쓴다는 뜻이고, 그게 우리 지정보다 세다.
   * 대신 **조용히 0 이 되면 안 된다** — 실패로 드러나야 사람이 gid 를 고칠 수 있다.
   */
  const grid = { sheets: [tab(5, '숨은 정본', [HEAD, CAR('01가1111')], { hidden: true })] } as unknown as SheetsGridResponse;
  const { tabs, failures } = readSupplierSheet(grid, partner({ sheet_tab: '5' }));
  ok('③ 지정한 탭이 숨김이면 안 읽고 실패로 알린다', tabs.length === 0 && failures.length === 1,
    `탭 ${tabs.length} · 실패 ${failures.length}`);
}

// ── ④ 헤더 행은 어댑터가 찾는다 ────────────────────────────────────
{
  // 진짜 헤더 위에 배너가 있는 시트(오토플러스 실물 구조).
  const grid = {
    sheets: [tab(0, '판매차량리스트', [
      ['★★★ 차량번호 클릭 후 이미지 다운로드 ★★★'],
      [''],
      HEAD,
      CAR('01가1111'),
    ])],
  } as unknown as SheetsGridResponse;
  const { tabs, failures } = readSupplierSheet(grid, partner());
  const head = tabs[0]?.table?.[0] || [];
  ok('④ 배너를 헤더로 오인하지 않는다', head[1] === '차량번호', `헤더 ${head.join('|')} · 실패 ${failures.length}`);
}
{
  const promoHead = [
    '순번', '차량번호', '차종', '모델명(트림풀명)', '색상', '연료',
    '최초등록일', '주행거리', '판매상태', '가격', '', '', '', '', '',
  ];
  const promoCar = ['1', '01가1111', '아반떼', '모던', '흰색', '가솔린', '2025-01', '1000', '판매중', '', '', '50', '49', '48', '47'];
  const grid = {
    sheets: [tab(284963459, '프로모션', [
      ['상단 안내'], promoHead, [], ['이미지 안내'], [], promoCar,
    ])],
  } as unknown as SheetsGridResponse;
  const { tabs, failures } = readSupplierSheet(grid, partner({ adapter_id: 'autoplus' }));
  ok('④ 헤더가 아래로 밀리고 안내행이 끼어도 그 아래 첫 차량 블록을 읽는다',
    tabs[0]?.table?.[1]?.[1] === '01가1111' && failures.length === 0,
    `탭 ${tabs.length} · 실패 ${failures.map((x) => x.reason).join(',')}`);
}

// ── 실패는 삼키지 않는다 ──────────────────────────────────────────
{
  const grid = { sheets: [tab(0, '메모', [['안내문만 있는 탭'], ['차 없음']])] } as unknown as SheetsGridResponse;
  const { tabs, failures } = readSupplierSheet(grid, partner());
  ok('실패한 탭은 failures 로 돌려준다', tabs.length === 0 && failures.length === 1,
    `탭 ${tabs.length} · 실패 ${failures.length}`);
}
{
  // 탭 하나가 실패해도 나머지는 읽어야 한다 — 공급사 전체가 «못 읽음»이 되면 안 된다.
  const grid = {
    sheets: [
      tab(0, '메모', [['안내문']]),
      tab(1, '재고', [HEAD, CAR('01가1111')]),
    ],
  } as unknown as SheetsGridResponse;
  const { tabs, failures } = readSupplierSheet(grid, partner());
  ok('탭 하나가 실패해도 나머지는 읽는다', tabs.length === 1 && failures.length === 1);
}

// ── 부속 ────────────────────────────────────────────────────────
ok('필드 마스크에 hidden 이 들어 있다', SHEET_GRID_FIELDS.includes('hidden'),
  '빠지면 ②가 조용히 죽는다');
ok('필드 마스크에 숨김 행 메타가 들어 있다',
  SHEET_GRID_FIELDS.includes('hiddenByFilter') && SHEET_GRID_FIELDS.includes('hiddenByUser'));
ok('읽기 재시도는 쿼터와 일시적 서버 오류만 허용한다',
  isRetryableSheetsReadFailure(429, 'quota exceeded')
  && isRetryableSheetsReadFailure(503, 'backend error')
  && !isRetryableSheetsReadFailure(403, 'permission denied'));
const serverSheetsSource = readFileSync('lib/server/google-sheet-visible.ts', 'utf8');
ok('Workspace 상품마스터 읽기는 명시된 위임 사용자로 토큰을 발급한다',
  serverSheetsSource.includes('GOOGLE_WORKSPACE_SUBJECT')
  && serverSheetsSource.includes("'pyh@teamjpk.com'")
  && serverSheetsSource.includes('{ sub: delegatedSubject }'));
ok('서버 Sheets 모듈은 위임 토큰으로 읽기 endpoint만 제공한다',
  serverSheetsSource.includes("scope: 'https://www.googleapis.com/auth/spreadsheets'")
  && !serverSheetsSource.includes(':batchUpdate')
  && !serverSheetsSource.includes('valueInputOption='));
ok('시트 주소에서 ID 를 뽑는다',
  sheetIdFromUrl('https://docs.google.com/spreadsheets/d/1AVW2uFy94qLPV4TU/edit?gid=9#gid=9') === '1AVW2uFy94qLPV4TU');
{
  const c = findPlateAndStatusColumns(HEAD);
  ok('상태·차번 열을 찾는다', c.plate === 1 && c.status === 0, `plate=${c.plate} status=${c.status}`);
  const none = findPlateAndStatusColumns(['가', '나']);
  ok('없으면 -1 을 돌려준다', none.plate === -1 && none.status === -1);
}

console.log(`\n${pass}/${pass + fail} PASS`);
if (fail) { console.log('\n★규격이 깨졌다. lib/domain/supplier-sheet-read.ts 의 「지켜야 할 네 가지」를 다시 읽어라.\n'); process.exit(1); }
