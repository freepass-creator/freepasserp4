/**
 * 표준양식이 **파서에 실제로 먹히는가** — 시트를 만들기 전에 여기서 통과해야 한다.
 *
 * 특히 「헤더 위 정책 3줄」이 헤더 자동탐지를 깨지 않는지가 관문이다.
 * 깨지면 공급사 재고가 통째로 0대가 된다(손오공·웰릭스 안내배너 사고와 같은 모양).
 *
 *   npx tsx scripts/sim-supplier-template.mts
 */
import { readFileSync } from 'node:fs';
import { resolveAdapter } from '../lib/domain/sheet-adapters';
import { importSheetTable } from '../lib/domain/sheet-import';
import { buildTemplateValues, TEMPLATE_COLUMNS, ROW_HEADER } from '../lib/domain/supplier-template-sheet';

let pass = 0, fail = 0;
const S = (v: unknown) => String(v ?? '').trim();
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

// 더미 마스터로는 스냅이 실패해 maker·trim 이 빈다 — 그건 양식이 아니라 시뮬의 문제다.
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const master = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

const adapter = resolveAdapter('generic');
const base = buildTemplateValues();
// 설명행은 공급사가 지우고 쓸 수도, 남길 수도 있다. 예시행 대신 진짜 데이터 2행을 넣는다.
const dataRow = (plate: string, status: string, rent: string) => {
  const r = Array(TEMPLATE_COLUMNS.length).fill('');
  const set = (name: string, v: string) => { r[TEMPLATE_COLUMNS.findIndex((c) => c.name === name)] = v; };
  set('차량번호', plate); set('상태', status); set('분류', '중고렌트');
  set('제조사', '현대');
  // 차명 한 칸에 트림까지 — 표준양식이 권하는 방식 그대로 시험한다.
  set('차명(트림)', '쏘나타 디 엣지 DN8 2.0 가솔린 인스퍼레이션');
  set('연식', '2024'); set('연료', '가솔린'); set('주행거리', '12000');
  set('외부색상', '흰색'); set('내부색상', '검정'); set('사진링크', 'https://drive.google.com/drive/folders/abc');
  set('차대번호', 'KMHL14JA1PA123456');
  set('정책코드', 'POL-0047');
  set('단기보증', '1200000'); set('12개월', '900000');
  set('장기보증', '1800000'); set('24개월', '820000'); set('36개월', '750000');
  return r;
};

const run = (table: string[][]) => importSheetTable(table, { providerCode: 'RPTEST', entries: master });

console.log('\n══ 공급사 표준양식 — 파서 적합성 ══\n');

// ① 정책 3줄이 있어도 헤더를 찾는가
{
  const t = [...base.slice(0, ROW_HEADER + 2), dataRow('123가4567', '출고가능', '900000')];
  const prepared = adapter.prepareTable(t.map((r) => [...r]));
  check('정책 3줄 위에 있어도 헤더행을 찾는다', prepared[0]?.[0] === '차량번호', `헤더 첫칸=${prepared[0]?.[0]}`);
}

// ② 실제 매물로 들어오는가
{
  const t = [...base.slice(0, ROW_HEADER + 1), dataRow('123가4567', '출고가능', '900000'), dataRow('456나7890', '출고협의', '900000')];
  const r = run(adapter.prepareTable(t.map((x) => [...x])));
  check('2대가 매물로 잡힌다', r.products.length === 2, `${r.products.length}대`);
  const p = r.products[0] as any;
  check('차량번호', p?.car_number === '123가4567', String(p?.car_number));
  check('차대번호(아무도 안 쓰던 칸)', p?.vin === 'KMHL14JA1PA123456', String(p?.vin));
  check('연식(아무도 안 쓰던 칸)', String(p?.year) === '2024', String(p?.year));
  check('사진링크(아무도 안 쓰던 칸)', String(p?.photo_link).includes('drive.google'), String(p?.photo_link));
  // 차명 한 칸만 줘도 마스터가 세대까지 잡고 검수로 안 떨어지는가 — 자유입력의 근거다.
  check('차명에서 세부모델을 잡는다', String(p?.sub_model).includes('디 엣지'),
    `sub_model=${p?.sub_model} · 검수필요=${p?._needs_master_review}`);
  check('차명 한 칸이면 검수가 안 뜬다', p?._needs_master_review !== true, `검수필요=${p?._needs_master_review}`);
  const trimKept = [p?.trim_name, p?.trim_extra].map(String).some((v) => v.includes('인스퍼레이션'));
  check('트림 텍스트가 유실되지 않는다', trimKept, `trim_name=${p?.trim_name} · trim_extra=${p?.trim_extra}`);
  // ★열 이름이 「차명」이면 model 로 가서 엉뚱한 세대가 붙는다(쏘나타 II Y3). 그 회귀를 막는다.
  check('세대를 잘못 잡지 않는다', !String(p?.sub_model).includes('Y3'), `sub_model=${p?.sub_model}`);
  check('제조사', p?.maker === '현대', String(p?.maker));
  // 「분류」는 새 표준 헤더다 — 별칭이 없으면 상품구분이 통째로 안 잡힌다.
  // 정책코드는 «우선» 값이다 — 파서가 안 읽으면 시트에 적어도 아무 일도 안 일어난다.
  check('정책코드가 매물에 실린다', S(p?.policy_code) === 'POL-0047', String(p?.policy_code));
  check('분류 → 상품구분', p?.product_type === '중고렌트', String(p?.product_type));
  // 내부색상이 '색상' 부분일치에 걸려 외장색으로 새지 않는지 — 별칭 정확일치가 지켜지는가.
  // 색상은 저장 시 정규화된다(흰색→화이트). 값이 «갈려 있는가»만 본다 —
  // 별칭 정확일치가 없으면 내부색상이 '색상' 부분일치로 ext_color 에 먹혀 int_color 가 빈다.
  check('외부색상/내부색상이 안 섞인다',
    !!S(p?.ext_color) && !!S(p?.int_color) && p?.ext_color !== p?.int_color,
    `외 ${p?.ext_color} · 내 ${p?.int_color}`);
  check('상태 출고가능', p?.vehicle_status === '출고가능', String(p?.vehicle_status));
  check('상태 출고협의', (r.products[1] as any)?.vehicle_status === '출고협의', String((r.products[1] as any)?.vehicle_status));

  // ③ 보증금 블록 스코프 — 단기보증이 12개월을, 장기보증이 24·36개월을 관할해야 한다
  const price = (p?.price || {}) as Record<string, any>;
  const dep = (k: string) => Number(price?.[k]?.deposit ?? price?.[k]?.보증금 ?? NaN);
  const rent = (k: string) => Number(price?.[k]?.rent ?? price?.[k]?.대여료 ?? NaN);
  check('12개월 대여료 900,000', rent('12') === 900000, JSON.stringify(price['12'] || null));
  check('12개월 보증금 = 단기보증 1,200,000', dep('12') === 1200000, String(dep('12')));
  check('24개월 보증금 = 장기보증 1,800,000', dep('24') === 1800000, String(dep('24')));
  check('36개월 보증금 = 장기보증 1,800,000', dep('36') === 1800000, String(dep('36')));
}

// ④ 출고불가는 걸러지는가
{
  const t = [...base.slice(0, ROW_HEADER + 1), dataRow('123가4567', '출고불가', '900000')];
  const r = run(adapter.prepareTable(t.map((x) => [...x])));
  check('출고불가는 유입에서 제외', r.products.length === 0, `${r.products.length}대`);
}

// ⑤ 공급사가 정책줄을 더 넣어 헤더가 밀려도 버티는가
{
  const extra = Array(TEMPLATE_COLUMNS.length).fill('');
  extra[0] = '추가 정책'; extra[1] = '주말 탁송 불가';
  const t = [...base.slice(0, ROW_HEADER), extra, ...base.slice(ROW_HEADER, ROW_HEADER + 1), dataRow('123가4567', '출고가능', '900000')];
  const r = run(adapter.prepareTable(t.map((x) => [...x])));
  check('정책줄이 늘어도 헤더를 찾는다', r.products.length === 1, `${r.products.length}대`);
}

// ⑥ 설명줄이 «차 한 대»로 읽히지 않는가 — 지금까지 시뮬이 이 줄을 빼고 시험해 구멍이었다.
{
  const t = [...base, dataRow('123가4567', '출고가능', '900000')];
  const r = run(adapter.prepareTable(t.map((x) => [...x])));
  check('설명줄이 매물로 잡히지 않는다', r.products.length === 1, `${r.products.length}대`);
  check('설명줄 아래 실데이터는 잡힌다', String((r.products[0] as any)?.car_number) === '123가4567',
    String((r.products[0] as any)?.car_number));
}

// ⑦ 정책 라벨이 헤더로 오인되지 않는가 (라벨 8칸이지만 차량번호 라벨이 없다)
{
  const prepared = adapter.prepareTable(base.map((r) => [...r]));
  check('정책행이 헤더로 오인되지 않는다', prepared[0]?.[0] === '차량번호', `헤더 첫칸=${prepared[0]?.[0]}`);
}

console.log(`\n── 통과 ${pass} · 실패 ${fail} ──\n`);
process.exit(fail ? 1 : 0);
