/** 손오공 API → 손오공 재고시트(1WIFn…) 원본칸 채우기.
 *
 *  구독재고 ← SON_NO_KONG(중고구독) · 픽업재고(없으면 신설) ← TCAR_EXTERNAL(픽업구독).
 *  정제칸 모델·세부모델·세부트림 = hourly-sync ⓪ `손오공-정제.mjs`(라이브 「차종마스터」 행 복사).
 *  ★한 번 채우면 끝(2026-09-02). 빈 칸만 쓴다. 이미 있는 이름·제원 칸은 매시간 안 덮는다.
 *  fill-supplier-ai-columns 는 이 시트를 안 탄다.
 *
 *  안전규칙:
 *   · ALWAYS  = 변동값(상태·주행거리·차량가격·인수형/반납형 가격·보증금 인수형)만 API로 갱신
 *   · FILLIFEMPTY = 정제칸·내부색상·최초등록일 — 기존 값 있으면 보존, 빈 칸만 채움
 *   · IDENTITY = 정체값(차번·분류·제조사·모델명·차명·외부색상·연식·연료·배기량·보증금반납형)
 *
 *    node scripts/손오공-재고시트.mjs            미리보기(라이브 안 건드림)
 *    node scripts/손오공-재고시트.mjs --쓰기      백업 후 반영
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sheet, colL } from '../lib/sheet.mjs';
import { withLease } from '../lib/lease.mjs';

const 루트 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ID = '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA';
const 쓰기 = process.argv.includes('--쓰기');
const 씻 = (x) => String(x ?? '').replace(/\s/g, '');
const 라운드천 = (v) => (v == null ? '' : Math.round(Number(v) / 1000) * 1000);
const 날 = (s) => (s ? String(s).slice(0, 10) : '');

// SON 세부모델 정제 — 배기량·연료·구동 노이즈를 걷어낸다(그건 배기량/구동방식 칸으로). 세대코드(CN7·4세대)는 남긴다.
function 세부모델정제(s) {
  return String(s || '')
    .replace(/\(?\s*[2-4]\s*WD\s*\)?/gi, ' ').replace(/\(?\s*(FWD|AWD|RWD)\s*\)?/gi, ' ').replace(/[2-4]륜구동/g, ' ')
    .replace(/가솔린\+전기|플러그인|하이브리드|HEV|가솔린|디젤|휘발유|경유|LPG|전기|터보/g, ' ')
    .replace(/\d\.\d\s*T?/g, ' ') // 배기량 1.6 2.2
    .replace(/\(\s*\)/g, ' ').replace(/\s*\(\s*/g, ' (').replace(/\s*\)\s*/g, ') ')
    .replace(/\s{2,}/g, ' ').trim();
}
// carName에서 구동방식 추출 → 롯데 표기와 맞춤(2륜구동/4륜구동)
function 구동추출(carName) {
  const s = String(carName || '');
  if (/4\s*WD|\bAWD\b/i.test(s)) return '4륜구동';
  if (/2\s*WD|\bFWD\b/i.test(s)) return '2륜구동';
  return '';
}
// carName에서 인승 추출("9인승" 등)
function 인승추출(carName) { const m = String(carName || '').match(/(\d{1,2})\s*인승/); return m ? m[1] : ''; }
// 연료 → 제원마스터 허용값으로 정규화(경유→디젤·휘발유→가솔린·HEV→하이브리드)
function 연료정규(f) {
  const s = String(f || '').trim();
  if (!s) return '';
  if (/경유|디젤|diesel/i.test(s)) return '디젤';
  if (/가솔린\+?전기|하이브리드|HEV|플러그인|PHEV|hybrid/i.test(s)) return '하이브리드';
  if (/전기|\bEV\b|electric/i.test(s)) return '전기';
  if (/LPG|가스|lpi/i.test(s)) return 'LPG';
  if (/가솔린|휘발유|gasoline|petrol/i.test(s)) return '가솔린';
  return s;
}

/**
 * 손오공 목록의 노출값은 VISIBLE만 쓰이지 않는다. 실제 목록에는 EXPOSED도
 * 계약가능=Y·계약중=false인 판매 가능 재고로 내려온다. 계약·인도 상태는
 * 정산원장이 뒤 단계에서 덮으므로, 여기서는 API가 «현재 목록에 있다»는
 * 사실에 맞는 기본 상태만 만든다.
 */
export function 손오공기본상태(c) {
  if (c.계약중) return '계약중';
  return ['VISIBLE', 'EXPOSED'].includes(String(c.노출 || '').trim().toUpperCase())
    ? '출고가능'
    : '출고불가';
}

// 대상 버킷 → (탭, 분류)
const 대상 = [
  { 버킷: 'SON_NO_KONG', 탭: '구독재고', 분류: '중고구독' },
  { 버킷: 'TCAR_EXTERNAL', 탭: '픽업재고', 분류: '픽업구독', 신설원본: '구독재고' },
];

// 차종마스터 시트 매칭 결과(scripts/손오공-정제.mjs --json 산출). 차번 → {모델,세부모델,세부트림,원산지}
let 정제맵 = new Map();
function 정제맵로드() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(루트, 'tmp', '손오공정제.json'), 'utf8'));
    for (const r of j.결과 || []) 정제맵.set(String(r.차번).replace(/\s/g, ''), r);
  } catch { /* 없으면 규격칸 빈칸 */ }
}

// 컬럼 정책: 헤더이름 → API에서 뽑는 함수 + 모드
function 값맵(c, 분류) {
  // 반납형(R)·인수형(B) 대여료. SON 대부분은 SUBSCRIBE_*(구독)지만, 일부는 RENT_*(렌트)만 있다
  //   (2026-08-28: SON 72대 중 7대가 RENT_*뿐 — SUBSCRIBE만 보면 대여료가 통째로 빈칸이 됐다).
  //   SUBSCRIBE 없으면 RENT로 폴백 — RENT 가격이 그 차의 실제 대여료라 맞다.
  const R = c.저신용월납?.SUBSCRIBE_RETURN || c.저신용월납?.RENT_RETURN || {};
  const B = c.저신용월납?.SUBSCRIBE_BUYOUT || c.저신용월납?.RENT_BUYOUT || {};
  const L = c.정제 || {}; // T카 롯데 정제값(SON은 {})
  const dep = c.보증금 || {};
  const 상태 = 손오공기본상태(c);
  // 정제값 — 모델·세부모델·세부트림·원산지 = 차종마스터 시트 매칭(정제맵). 제원(배기량·연료·외장·구동·인승·차종·내장) = 팩트.
  const isT = c.버킷 === 'TCAR_EXTERNAL';
  const M = 정제맵.get(씻(c.차번)) || {}; // 차종마스터 시트 규격(없으면 {} → 그 칸 빈칸)
  // 이름칸: 값이 있는 축만, 그리고 빈 칸만(FILLIFEMPTY). 한 번 채운 모델·세부모델을 매시간 다시 쓰지 않는다.
  const 이름칸 = M.모델 ? {
    '모델': M.모델,
    ...(M.제조사 ? { '제조사(정제)': M.제조사 } : {}),
    ...(M.세부모델 ? { '세부모델': M.세부모델 } : {}),
    ...(M.세부트림 ? { '세부트림': M.세부트림 } : {}),
    ...(M.원산지 ? { '원산지': M.원산지 } : {}),
    ...(M.세부모델 ? {
      '차명(정제)': (() => {
        const sub = String(M.세부모델 || '').trim();
        const trim = String(M.세부트림 || '').trim();
        const flat = (s) => s.replace(/\s/g, '');
        return trim && !flat(sub).includes(flat(trim)) ? `${sub} ${trim}` : sub;
      })(),
    } : {}),
  } : {};
  const 정제값 = {
    '외장색상': (isT ? L.외장 : c.외장) || '', '연료(정제)': 연료정규(isT ? L.연료 : c.연료), '배기량(정제)': (isT ? L.배기량 : c.배기량) || '',
    // T카는 롯데 제원(내장·구동·인승·차종)까지. SON은 carName에서 뽑히는 구동·인승만(차종·내장은 손오공 소스 없음).
    ...(isT
      ? { '내장색상': L.내장 || '', '구동방식': L.구동 || '', '인승': L.인승 || '', '차종구분': L.차종 || '' }
      : { '구동방식': 구동추출(c.차명), '인승': 인승추출(c.차명) }),
  };
  return {
    IDENTITY: {
      '차량번호': c.차번, '분류': 분류, '제조사': c.제조사, '모델명': c.모델,
      '차명(세부모델+트림)': c.차명, '외부색상': c.외장, '연식': String(c.연식 || '').slice(0, 4),
      '연료': c.연료, '배기량': c.배기량,
      // 보증금 반납형=인수형 동일: 연수×대여료, 최대 ×3(3개월분) — 48·60개월도 ×3 상한(사장님 2026-08-27)
      '보증금 반납형': '연수×대여료(최대 ×3)', '보증금 인수형': '연수×대여료(최대 ×3)',
    },
    ALWAYS: {
      '상태': 상태, '주행거리': c.주행거리 ?? '', '차량가격': c.차량가격 ?? '',
      '12개월 인수형': 라운드천(B[12]), '24개월 인수형': 라운드천(B[24]), '36개월 인수형': 라운드천(B[36]),
      '48개월 인수형': 라운드천(B[48]), '60개월 인수형': 라운드천(B[60]),
      '12개월 반납형': 라운드천(R[12]), '24개월 반납형': 라운드천(R[24]), '36개월 반납형': 라운드천(R[36]),
      '48개월 반납형': 라운드천(R[48]), '60개월 반납형': 라운드천(R[60]),
      // 옵션·선택옵션 = 유상옵션(참고용) 원문. 없으면 빈칸(사장님 2026-08-27 「옵션이 잘못됐어·유상옵션 가져오라」).
      // 기본장비 목록(options[])은 노이즈라 안 쓴다 → 덮어써서 잘못된 기존 덤프도 걷어냄.
      '옵션': c.유료옵션 || '', '선택옵션': c.유료옵션 || '',
      // ★차번링크 = 티카 상세페이지(픽업만). 사장님 2026-08-28 「픽업차의 차량번호 셀을 누르면 티카 상세페이지로」.
      //   ⚠ 「사진링크」에 넣으면 안 된다 — 그 칸은 ERP가 <img>로 그려서 HTML을 넣으면 사진이 깨진다
      //     (2026-08-28 실측 337대). 그래서 «전용 칸»을 따로 둔다.
      //   SON은 상세url이 없어 빈칸이고, 판매 발행은 빈칸이면 예전처럼 사진 첫 장으로 떨어진다.
      '차번링크': /^https?:\/\//.test(String(c.상세url || '')) ? c.상세url : '',
    },
    // ★T카 정제칸 — 롯데 티카 페이지에서 정제해온 값(c.정제). SON은 c.정제=null이라 안 채움(차종마스터 팀 담당).
    //   값 있을 때만 씀(SETIFVALUE) — 규격이름(모델·세부모델·세부트림)은 T카는 롯데가 정본(사장님 2026-08-27 「티카꺼만 정제해서」).
    FILLIFEMPTY: {
      ...이름칸,
      ...정제값,
      '내부색상': c.내장 || '', '최초등록일': 날(c.최초등록),
    },
  };
}

function 행빌드(header, 기존, c, 분류) {
  const m = 값맵(c, 분류);
  const row = header.map((h, i) => (기존 ? (기존[i] ?? '') : ''));
  const put = (name, v, mode) => {
    const i = header.indexOf(name);
    if (i < 0) return;
    if (mode === 'ALWAYS' || mode === 'IDENTITY') row[i] = v;
    else if (mode === 'NAMES' || mode === 'FILLIFEMPTY') {
      if (!String(row[i] ?? '').trim() && v !== '' && v != null) row[i] = v;
    }
    else if (mode === 'SETIFVALUE') { if (v !== '' && v != null && !String(row[i] ?? '').trim()) row[i] = v; }
  };
  for (const [k, v] of Object.entries(m.IDENTITY)) put(k, v, 'IDENTITY');
  for (const [k, v] of Object.entries(m.ALWAYS)) put(k, v, 'ALWAYS');
  for (const [k, v] of Object.entries(m.NAMES || {})) put(k, v, 'NAMES');
  for (const [k, v] of Object.entries(m.SETIFVALUE || {})) put(k, v, 'SETIFVALUE');
  for (const [k, v] of Object.entries(m.FILLIFEMPTY)) put(k, v, 'FILLIFEMPTY');
  // ★사진링크 = «이미지» URL. ERP가 이 칸을 <img>로 그린다 → 반드시 이미지라야 뜬다.
  //   예전엔 T카에 상세페이지(tcar.lotterentacar.net/cr/search/view = HTML 158KB)를 최우선으로 넣어
  //   픽업 사진 337대가 전부 깨졌다(사장님 「사진 갖고오는 게 ERP에서 안 됨」 2026-08-28).
  //   상세페이지 말고 «사진들 전부»(콤마)로 넣는다 — ERP 갤러리가 콤마/줄바꿈으로 쪼개 여러 장을 보여준다
  //   (사장님 「1장만 뜨네」 2026-08-28). 롯데 서버가 리사이즈 파라미터를 무시해 원본 2.3MB라, 모바일 부담으로 10장까지만.
  //   차번 셀 하이퍼링크는 발행기가 «첫 장»만 건다(sales-sheet-format). 기존 단일 링크(드라이브 등)는 보존.
  const pi = header.indexOf('사진링크');
  if (pi >= 0) {
    const cur = String(row[pi] ?? '');
    const 우리드라이브사진 = /drive\.google\.com\/drive\/folders\/[\w-]{15,}/i.test(cur);
    const 사진들 = (Array.isArray(c.사진들) ? c.사진들 : []).map((u) => String(u).trim()).filter((u) => /^https?:\/\//.test(u)).slice(0, 10);
    const 이미지 = 사진들.join(', ');
    const 쓸모없음 = !cur.trim() || cur.includes('\n') || /tcar\.lotterentacar\.net\/cr\//.test(cur);
    if (우리드라이브사진) { /* 우리 보관본은 API 링크로 되돌리지 않는다 */ }
    else if (이미지) row[pi] = 이미지;       // 사진들 있으면 항상 전체(콤마) — 갤러리 여러 장
    else if (쓸모없음) row[pi] = '';         // 사진 없고 옛 값이 HTML/빈/여러줄이면 비움(HTML 남기면 깨진 이미지)
    // else: 기존 단일 이미지 링크(드라이브 등) 보존
  }
  return row;
}

async function main() {
  정제맵로드();
  const 차량 = JSON.parse(fs.readFileSync(path.join(루트, 'lib/wonja/손오공차량.json'), 'utf8')).차량;
  const s = await sheet(ID);
  const tabs = await s.tabs();

  const plan = [];
  for (const t of 대상) {
    const cars = 차량.filter((c) => c.버킷 === t.버킷);
    let tab = tabs.find((x) => x.title.replace(/\s.*$/, '') === t.탭 || x.title === t.탭);
    const 신설 = !tab;
    // 헤더 확보 (신설 예정이면 원본 탭 헤더 사용)
    const 헤더원 = 신설 ? tabs.find((x) => new RegExp(t.신설원본).test(x.title)) : tab;
    const v = await s.values(헤더원.title, 'A1:BZ1000', 'FORMATTED_VALUE');
    const header = (v[0] || []).map((h) => String(h ?? '').trim());
    const 기존행 = 신설 ? [] : v.slice(1).filter((r) => 씻(r[header.indexOf('차량번호')]));
    const 기존맵 = new Map(기존행.map((r) => [씻(r[header.indexOf('차량번호')]), r]));

    const apiNums = new Set(cars.map((c) => 씻(c.차번)));
    const rows = cars.map((c) => 행빌드(header, 기존맵.get(씻(c.차번)), c, t.분류));
    // API에 없는 기존 차는 삭제 말고 보존 — 단 손오공이 더는 안 파는 차이므로 «출고불가»로 내린다.
    //   → 판매·ERP·천이·영업 목록에서 빠지고(출고불가 제외 규칙), 시트엔 기록으로 남는다.
    //   API에 돌아오면 행빌드가 fresh 상태로 자동 복구. 상세페이지(HTML) URL도 비운다(깨진 이미지 방지).
    const pi사진 = header.indexOf('사진링크');
    const pi상태 = header.indexOf('상태');
    const 보존행 = 기존행.filter((r) => !apiNums.has(씻(r[header.indexOf('차량번호')]))).map((r) => {
      const c = r.slice();
      if (pi상태 >= 0) c[pi상태] = '출고불가';
      if (pi사진 >= 0 && /tcar\.lotterentacar\.net\/cr\//.test(String(c[pi사진] ?? ''))) c[pi사진] = '';
      return c;
    });
    const allRows = rows.concat(보존행);
    plan.push({ t, tab, 신설, 헤더원: 헤더원.title, header, rows: allRows, cars, 기존수: 기존행.length, 신규: cars.filter((c) => !기존맵.has(씻(c.차번))).length, 보존: 보존행.length });
  }

  // 요약
  for (const p of plan) {
    console.log(`\n[${p.t.탭}${p.신설 ? ' ★신설' : ''}] ${p.t.버킷} → 총 ${p.rows.length}행 (API ${p.cars.length}: 신규 ${p.신규}·갱신 ${p.cars.length - p.신규} + API에없어 보존 ${p.보존})`);
    console.log('  헤더칸:', p.header.length, '| 사진있음', p.cars.filter((c) => c.사진들?.length).length, '| 옵션있음', p.cars.filter((c) => c.옵션).length);
    const s0 = p.rows[0]; const idx = (n) => p.header.indexOf(n);
    console.log('  샘플:', ['차량번호', '분류', '제조사', '모델명', '차량가격', '60개월 반납형', '옵션'].map((n) => `${n}=${String(s0[idx(n)] ?? '').slice(0, 18)}`).join(' · '));
  }

  if (!쓰기) {
    const p = path.join(루트, 'tmp', '손오공재고시트-preview.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(plan.map((x) => ({ 탭: x.t.탭, 신설: x.신설, header: x.header, rows: x.rows })), null, 1));
    console.log(`\n[미리보기만] 라이브 안 건드림 → ${p}\n실제 반영: node scripts/손오공-재고시트.mjs --쓰기`);
    return;
  }

  const taskId = 'OPS-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-003';
  await withLease('sheet:' + ID, { agent: 'claude', taskId, purpose: '손오공 재고시트 구독/픽업 반영' }, async () => {
    const bp = await s.backup(path.join(루트, 'backups', 'sonokong-stock'));
    console.log('백업:', bp);
    for (const p of plan) {
      let title = p.tab?.title;
      if (p.신설) {
        // 원본 탭 복제 → 이름 변경 → 데이터 비우기
        const src = (await s.tabs()).find((x) => x.title === p.헤더원);
        await s.batchUpdate([{ duplicateSheet: { sourceSheetId: src.sheetId, newSheetName: p.t.탭, insertSheetIndex: 2 } }]);
        title = p.t.탭;
        const 끝열 = colL(p.header.length - 1);
        await s.write(`'${title}'`, `A2:${끝열}1000`, Array.from({ length: 999 }, () => Array(p.header.length).fill('')));
        console.log(`  ★ ${title} 탭 신설(구독재고 복제)`);
      }
      const 끝열 = colL(p.header.length - 1);
      // 데이터 영역 정리 후 쓰기
      await s.write(`'${title}'`, `A2:${끝열}1000`, Array.from({ length: 999 }, () => Array(p.header.length).fill('')));
      await s.write(`'${title}'`, `A2:${끝열}${1 + p.rows.length}`, p.rows);
      console.log(`  ✅ ${title} ← ${p.rows.length}대`);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('실패:', e.message); process.exit(1); });
}
