/**
 * **정제시트(아이카·오토플러스·이안카·아이언)마다 「정제시트 안내」 탭 한 장** — 이 시트는 공급사가 적는 시트가 아니라
 * 원본(공급사 시트·홈페이지)을 우리 규격으로 옮겨 담는 시트라는 것, 칸마다 누가 정본인지, 무엇을 여기서 고치고 무엇은 원본에서 고치나.
 * 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-18 — 「각 공급사 시트에서 직접 입력하는 거는 직접 입력하면 되고 그게 아니면 매뉴얼탭을 다 만들어줘 —
 *   아이카·이안카·오토플러스·아이언 정제시트에 매뉴얼을 만들어 주세요」
 *   직접 입력하는 시트의 「작성 안내」(publish-supplier-guide-tab)는 «여기에 적어 주세요»라 정제시트에는 틀린 말이다 — 그 탭은 지우고 이 탭을 둔다.
 * ★내용은 코드 정본에서 나온다 — 대상·원본은 `mirror-sources`, 칸 소유는 `supplier-template-sheet.columnOwner`, 별칭은 `mirror-sheet-mapping`.
 * ★사장님 2026-08-18 — 「실시간 연동은 내가 걸어 둘게 — 제미나이랑 구글시트 기능 써서 할 테니까 너는 매뉴얼만 잘 만들어 놔, 탭에 숨겨서」 ·
 *   「연동 매뉴얼에 원본시트·정제시트가 있어야 하고」 · 「우리가 제공하는 곳은 정제시트가 곧 우리가 제공한 거야, 원본인 거고」 ·
 *   「아이언은 원본시트가 홈페이지로 대체되는 거고」. 그래서 이 탭은 **숨김**이고, 원본 시트 주소·탭·머리행 번호·열 글자 → 정제시트 열
 *   대응표(실측)와 값 규격화 규칙, 구글시트 수식(IMPORTRANGE 등)으로 걸 때의 함정을 담는다 — 제미나이가 보고 그대로 걸 수 있게.
 * ⚠ 이 탭은 기계가 통째로 다시 쓴다.
 *
 *   npx tsx scripts/publish-mirror-guide-tab.mts
 *   npx tsx scripts/publish-mirror-guide-tab.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { MIRROR_SOURCES, type MirrorSource } from '../lib/domain/mirror-sources';
import { MIRROR_ALIAS, MIRROR_OWNER_RULE, isMirrorFollowSource, sourceColumnsFor } from '../lib/domain/mirror-sheet-mapping';
import { MAKER_STANDARD_NOTE } from '../lib/domain/maker-display';
import { mergeAutoplusHeaderRows } from '../lib/domain/sheet-adapters';
import { AI_TAIL_COLUMNS, columnOwner, isDividerColumn } from '../lib/domain/supplier-template-sheet';
import { FONT_DEFAULT, SIZE } from '../lib/domain/sales-sheet-format';
import { AI_TOUCH_RULES } from '../lib/domain/ai-touch-rules';
import { SHEET_READING_RULES } from '../lib/domain/sheet-reading-rules';
import { VEHICLE_REFINE_FLOW } from '../lib/domain/vehicle-refine-flow';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONLY = new Set(arg('only').split(',').map(S).filter(Boolean));
const TAB = '정제시트 안내';
const OLD_TAB = '작성 안내';
const url = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

/** 공급사별 특이사항 — 코드에 박힌 사실만(실측 2026-08-18). */
const NOTES: Record<string, string[]> = {
  RP004: [
    '원본 「(수정본)아이카 장기차량 리스트」의 장기특별이벤트·중고재렌트·신차선출고 세 탭을 읽는다(월렌트·수수료 탭은 재고가 아니라 안 읽는다).',
    '원본에서 **숨긴 줄**은 «안 파는 차»로 본다 — 여기서는 상태가 출고불가로 내려간다. 아이카가 줄을 다시 펴면 다음 미러에 되살아난다.',
    '원본 「월렌트」 칸은 우리 「1개월」, 「소비자가격」은 「차량가격」. 「차종분류」는 모델 이름(카니발·BMW 5시리즈 — 준중형 SUV 가 아님)이고, 「트림」과 합쳐 「차명(세부모델+트림)」이 된다. 「최초등록 26-7-24」는 「2026-07-24」로 온다.',
    '줄에 붙은 대인·대물·자차·자손·연주행은 「정책」 탭 RP004_… 줄로 접혀 들어가고 재고 「정책코드」가 그 줄을 가리킨다.',
  ],
  RP023: [
    '원본 「New 오토플러스 재고 리스트」의 판매차량리스트(첫 현재재고 블록만)·EV 프로모션 탭을 읽는다. 공지사항은 안 읽는다.',
    '대여료 블록만 오플 구조다 — 「장기보증 · 12개월2만 · 12개월3만 · 18개월2만 · 18개월3만 · 24개월2만 · 24개월3만 · 36개월2만 · 36개월3만」(2만/3만 = 연 약정주행). ERP 파서는 「12개월3만」을 그대로 읽는다 — 열 이름을 바꾸지 말 것.',
    '「차종」+「모델명」(풀 트림 문장, 예: X1(2세대) 20i xDrive x라인)이 「차명(세부모델+트림)」. 모델명만 옮기면 차종(X1·K8)이 빠진다.',
    '보증금은 원본에 없다 → 「장기보증」을 비워 둔다. ERP 가 공급사 보증금 규칙(partner.deposit_rule)으로 채운다. 여기에 계산해 넣지 않는다.',
    '「판매시작일」은 「입고일자」로 온다(재고일수 계산). 「판매상태 할인판매」는 「출고가능」으로 규격화된다.',
    '조건 칸이 없어 정책은 「(프리패스 기본)」이다. 판매시트에서는 오플 전체가 「상품리스트」에서 빠지고 「오플구독·오플프로모션」 탭(원본 통째 복사)에 선다.',
  ],
  RP031: [
    '원본 「이안카_프리패스」의 「이안카 재렌트」 탭이 「이안카」 탭보다 우선한다(같은 차면 재렌트 값).',
    '원본 「상태 재고확인」은 「출고협의」로 규격화된다(ERP 와 같은 판정). 원본 「입고일자」에 「재고확인」 글자가 든 줄은 날짜가 아니라 안 옮긴다(잡음).',
    '「차종분류 + 세부모델 + 트림」이 「차명(세부모델+트림)」 한 칸으로 합쳐 온다(겹치는 말은 한 번만).',
    '줄에 붙은 대인·대물·자차·자손·무보험·연주행·분납·21세·23세·1만+·정비·운전자범위·전용계좌·기타는 「정책」 탭 RP031_S01/S03(ERP 정책 코드와 같다)로 접혀 들어간다.',
  ],
  RP006: [
    '원본은 시트가 아니라 **ironrentcar.com** 이다(신차·중고 목록 → 상세 페이지). 아이언이 준 옛 구글시트는 정본이 아니다.',
    '판매완료 차는 옮기지 않는다 — 여기 있던 차가 홈페이지에서 사라지면 상태만 출고불가로 내려간다.',
    '기간: 표준 6기간 + 예비칸 제목을 「72개월」·「84개월」로 바꿔 썼다. 53개월처럼 표준 밖 기간은 「기타기간③」에 「53개월 580,000」처럼 글자로 남긴다(파서는 안 읽고 사람이 본다).',
    '보증금은 홈페이지에 한 값 → 「장기보증」. 사진링크 = 상세 페이지 주소. 차량가격 = 관리자 전용 원가.',
    '조건은 홈페이지 공개조건(만 26세 이상·대인 무한·대물 1억·자손 1천5백·면책 30/30/30·자차 50~100·연 3만km·긴급출동 5회·2회 분납·소득심사)을 「정책」 탭 RP006_WEB 에 손으로 박아 두었다 — 홈페이지가 바뀌면 사람이 고친다(자동 아님).',
    'ERP 쪽 홈페이지 직접 반영 화면(/api/inventory/ironrentcar)은 아직 살아 있다 — 정제시트→상품마스터 길이 자리 잡으면 내리거나 검증 전용으로 둔다.',
  ],
};

const OWNER_LABEL: Record<string, string> = { live: '공급사(매번 원본을 따라간다)', ours: '프리패스(우리 것 — 원본이 못 덮는다)', once: '처음 한 번 원본에서, 그 뒤 우리 기록' };
const aliasOf = new Map(MIRROR_ALIAS.map(([ours, cands]) => [ours, cands.filter((c) => c !== ours).join(' / ')]));

const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const normName = (v: unknown) => S(v).replace(/\s+/g, '');
type TabMap = { title: string; gid: number; hidden: boolean; headerRow: number; cols: { letter: string; name: string; ours: string[] }[]; twoRow: boolean };
/**
 * 원본 탭 하나의 «열 글자 → 정제시트 열» 대응(실측). 머리행은 차량번호가 있는 첫 줄, 오토플러스는 두 줄 머리(12개월/3만km)를 합친 이름.
 * 대응은 실제 미러가 쓰는 projectSourceRow 로 구한다 — 열마다 표식 값을 넣고 어디로 가는지 본다(문서와 코드가 갈리지 않게).
 */
async function tabMaps(m: MirrorSource, ourHeader: string[], call: (u: string) => Promise<Rec>): Promise<TabMap[]> {
  if (m.kind !== 'sheet') return [];
  const meta = await call(`${SH}/${m.from}?fields=sheets.properties(sheetId,title,hidden)`);
  const out: TabMap[] = [];
  for (const p of (meta.sheets || []).map((x: Rec) => x.properties)) {
    const title = S(p.title);
    let v: { values?: string[][] };
    try { v = await call(`${SH}/${m.from}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ25`)}`) as { values?: string[][] }; } catch { continue; }
    const grid = (v.values || []).map((r) => r.map(S));
    const hi = grid.findIndex((r) => r.some((c) => /^차량번호$|^차번$/.test(normName(c))));
    if (hi < 0) continue;
    let hdr = grid[hi];
    const sub = grid[hi + 1] || [];
    const twoRow = m.code === 'RP023' && sub.some((c) => /\d+\s*만\s*km/i.test(c));
    if (m.code === 'RP023') hdr = mergeAutoplusHeaderRows(hdr, twoRow ? sub : []);
    const cols = hdr.map((name, i) => ({ letter: colA1(i), name: S(name), ours: [] as string[] })).filter((c) => c.name);
    const ourNorm = new Set(ourHeader.map(normName));
    for (const [ours, srcs] of sourceColumnsFor(hdr)) {
      if (!ourNorm.has(ours)) continue;                    // 정제시트 머리행에 없는 열로는 안 간다
      for (const sname of srcs) { const c = cols.find((x) => normName(x.name) === normName(sname)); if (c && !c.ours.includes(ours)) c.ours.push(ours); }
    }
    out.push({ title, gid: Number(p.sheetId), hidden: !!p.hidden, headerRow: hi + 1, cols, twoRow });
  }
  return out;
}
const IRON_MAP: [string, string][] = [
  ['차량번호', '상세 「차량번호」(dt/dd) — 열쇠'], ['상태', '배지 — 판매완료→출고불가 · 즉시출고 · 출고가능 · 그 밖→출고협의'],
  ['분류', '목록 condition — new→신차렌트 · used→중고렌트'], ['제조사', '상세 제목 첫 단어'], ['차명(세부모델+트림)', '상세 제목에서 제조사를 뺀 나머지'],
  ['옵션', '옵션 칩 전부(, 로 이음)'], ['외부색상', '「외장 색상」'], ['내부색상', '「내장 색상」'], ['연식', '부제의 연도'], ['주행거리', '「주행거리」 숫자'],
  ['연료', '「유종」 → 규격값'], ['차량가격', '차량가 블록(관리자 전용)'], ['장기보증', '보증금 블록(한 값)'], ['1·12·24·36·48·60·72·84개월', '기간별 대여료 행(dt 기간·dd 금액)'],
  ['기타기간③', '표준 밖 기간(53개월 등)을 「53개월 580,000」 글자로'], ['사진링크', '상세 페이지 주소'], ['정책 탭 RP006_WEB', '상세 조건(운전자 연령·대인·대물·자기신체·면책금·긴급출동·보증금 분납·연 주행)을 손으로 옮긴 것 — 자동 아님'],
];
const STATUS_RULES = [
  '규격값 6개(즉시출고·출고가능·상품화중·출고협의·계약중·출고불가) 그대로 → 그대로',
  '「출고가능…」으로 시작 → 출고가능 (예: 출고가능(정비중))',
  '출고완·판매완료·매각·반납·폐차·말소·회수·사고·보류·미정·대차·sold → 출고불가',
  '배차중·운행중·대여중·임대중(대기·가능·예정이 같이 없을 때) → 출고불가 — 남이 타는 차',
  '불가·블가·출고불 → 출고불가',
  '판매중·할인판매·promo → 출고가능',
  '상품화 → 상품화중 · 「계약…」 → 출고불가(ERP 계약중은 내부 전용)',
  '그 밖 전부(배차대기·재고확인·재렌트·「8월3일 이후 출고가능」…) → 출고협의',
];

async function buildRows(m: MirrorSource, header: string[], maps: TabMap[]): Promise<string[][]> {
  const rows: string[][] = [];
  const R = (...c: string[]) => rows.push([c[0] || '', c[1] || '', c[2] || '', c[3] || '']);
  R(`${m.name} 정제시트 — 연동 매뉴얼`, '', '', '');
  R('', `이 시트는 ${m.name}이(가) 적는 시트가 **아닙니다**. ${m.kind === 'iron' ? 'ironrentcar.com 홈페이지(원본시트를 대신한다)' : `${m.name} 자체 시트(원본)`}를 프리패스 규격으로 옮겨 담는 «정제시트»입니다. 판매시트·상품마스터·ERP 는 이 시트만 읽습니다(문패 「공급사시트정리」가 여기를 가리킴). 우리가 시트를 제공해 공급사가 직접 적는 곳은 그 시트가 곧 원본이자 정제시트다 — 그런 곳엔 이 탭이 없다.`, '', '');
  R('0. 이 시트가 읽히는 방식', '', '', ''); R('무엇', '어떻게', '왜', ''); for (const x of SHEET_READING_RULES) R(x.what, x.how, x.why, ''); R('', '', '', '');
  R('원본시트', m.kind === 'iron' ? 'https://www.ironrentcar.com' : url(m.from!), m.kind === 'iron' ? '신차·중고 목록 → 상세 페이지 (원본시트가 홈페이지로 대체됨)' : `읽는 탭: ${maps.filter((t) => !t.hidden).map((t) => `「${t.title}」(gid ${t.gid}, 머리행 ${t.headerRow}행)`).join(' · ')}${maps.some((t) => t.hidden) ? ` · 숨긴 탭(안 읽음): ${maps.filter((t) => t.hidden).map((t) => `「${t.title}」`).join(' · ')}` : ''}`, '');
  R('정제시트', url(m.to), '「재고」 탭 = 우리 규격(머리행 1행) · 「정책」 탭 · [숨김] 이 안내 · [숨김] AI 인계', '');
  R('지금 연동', '문패 「공급사시트정리」 → 정제시트(2026-08-18 전환). 원본 → 정제시트 옮김은 코드 미러(sync-mirror-all)이거나, 사장님이 구글시트 기능으로 직접 건다 — **둘을 같이 켜지 않는다**(서로 덮는다). 수식으로 걸면 mirror-sources.ts 에서 이 공급사를 뺀다.', '', '');
  R('', '', '', '');
  R('1. 원본 열 → 정제시트 열 대응표 (실측 · 코드 미러와 같은 규칙)', '', '', '');
  if (m.kind === 'iron') {
    R('정제시트 열', '홈페이지 어디서', '', '');
    for (const [a, b] of IRON_MAP) R(a, b, '', '');
  } else {
    for (const t of maps) {
      if (t.hidden) continue;
      R(`원본 탭 「${t.title}」`, `gid ${t.gid} · 머리행 ${t.headerRow}행${t.twoRow ? ` · 머리가 두 줄(기간/약정주행) → 「12개월3만」처럼 합친 이름` : ''} · 자료는 머리행 다음 줄부터`, '', '');
      R('원본 열', '원본 머리글', '→ 정제시트 열', '비고');
      for (const c of t.cols) {
        const ours = c.ours.length ? c.ours.map((o) => header.find((h) => normName(h) === o) || o).join(' + ') : '(안 옮김)';
        const note = c.ours.some((o) => o === '차명(세부모델+트림)') && /차종|분류|트림|모델/.test(c.name) ? '차명(세부모델+트림)은 차종/차종분류·모델명/세부모델·트림을 겹치지 않게 이어 붙인 값' : (!c.ours.length && /대인|대물|자차|자손|무보험|연주행|분납|21세|23세|1만|정비|운전자범위|계좌|기타|비고/.test(c.name) ? '줄별 조건 → 「정책」 탭(정책코드로 조인)' : '');
        R(c.letter, c.name, ours, note);
      }
      R('', '', '', '');
    }
  }
  R('2. 값 규격화 — 옮길 때 글자를 바꾸는 칸 (나머지는 원문 그대로)', '', '', '');
  R('상태', STATUS_RULES.join('\n'), '', 'canonSheetVehicleStatus — ERP 와 같은 판정');
  R('분류', '신차/재렌트/구독 표기 → 신차렌트 · 중고렌트 · 신차구독 · 중고구독', '', '');
  R('연료', '휘발유→가솔린 · 경유→디젤 · EV→전기 · 엘피지→LPG · HEV→하이브리드', '', '');
  // ★사장님 2026-08-18 — 「제조사는 르노라고만 하고 KGM — 매뉴얼에 박아서 모든 시트 통일」
  R('제조사', MAKER_STANDARD_NOTE, '', 'maker-display.canonMakerDisplay — 제조사·제조사(정제) 둘 다. 규격 밖 이름(포드 등)은 그대로');
  R('빈 칸 채우는 규칙', '연식이 원본에 없으면 최초등록일의 연도 · 입고일자가 원본에 없으면 «우리 시트에 처음 선 날»(새 줄만) · 제조사·배기량·연료 앞칸이 비고 정제칸이 있으면 정제칸 값 · 오토플러스 분류=중고렌트·정책코드=(프리패스 기본)(원본에 그 칸이 없어서)', '', 'mirror-sheet-mapping.projectSourceRow · sync-mirror-sheet(FROM_AI·DEFAULTS) · mirror-sources.defaults');
  R('입고일자·최초등록일', '「23-9-21」→2023-09-21 · 「2025. 3. 25」→2025-03-25 · 「26년3월」→2026-03. 날짜 아닌 글자(「재고확인」)는 안 옮김. ⚠ 두 자리 연도를 그대로 넣으면 구글이 1921·1930년으로 읽는다', '', '');
  R('돈·주행거리·색·옵션·차량가격', '공급사 글자 그대로(콤마 있어도 됨). 보증금을 규칙으로 계산해 넣지 않는다', '', '');
  R('', '', '', '');
  R('2-1. AI(프리패스 자동화)가 적고 만지는 칸 — 규칙 (제공시트 「작성 안내」와 같은 글)', '', '', '');
  R('무엇', '어떻게', '언제', '');
  for (const r of AI_TOUCH_RULES) R(r.what, r.how, r.when, '');
  R('', '', '', '');
  R('2-2. 차명 정제 흐름 — 차종마스터·상품마스터에 맞추고 → 정제칸에 박고 → 상품시트로', '', '', '');
  R('단계', '무엇을', '어디서/명령', '');
  for (const f of VEHICLE_REFINE_FLOW) R(f.step, f.what, f.where, '');
  R('', '', '', '');
  R('3. 칸마다 누가 정본인가 (정제시트 「재고」 머리행 차례)', '', '', '');
  R('한 줄', MIRROR_OWNER_RULE, '', 'mirror-sheet-mapping.MIRROR_FOLLOW_SOURCE · columnOwner');
  R('칸', '정본 · 갱신 규칙', '원본에서 이 이름으로 온다', '비고');
  for (const name of header) {
    if (!name) continue;
    if (isDividerColumn(name)) { R(name, '구분선 — 여기부터 오른쪽은 프리패스/AI 칸', '(값 없음)', ''); continue; }
    const owner = isMirrorFollowSource(name) ? 'live' : columnOwner(name);
    const isAi = AI_TAIL_COLUMNS.some((c) => c.name === name);
    const from = isAi ? '(원본 아님 — 프리패스가 채움)' : (aliasOf.get(name) || (/개월/.test(name) ? '같은 이름' : '같은 이름'));
    const note = name === '상태' ? '원문을 ERP 와 같은 규격값(즉시출고/출고가능/상품화중/출고협의/출고불가)으로 맞춘다. 원본에서 사라진 차는 출고불가'
      : name === '정책코드' ? (m.policies ? '원본 줄의 조건 칸을 정책 탭으로 접어 넣고 여기 코드가 붙는다(sync-mirror-policies). 사람이 다른 코드를 고르면 그대로 둔다' : '비면 「(프리패스 기본)」')
        : name === '차명(세부모델+트림)' ? '원본 여러 칸(차종/차종분류·모델명·세부모델·트림)을 겹치지 않게 합친 원문. 매번 원본을 따른다. 정제된 이름은 뒤 정제칸(모델·세부모델·세부트림)'
          : name === '옵션' ? '원본 옵션 칸 그대로. 매번 원본을 따른다. 정제된 선택옵션은 오른쪽 칸'
          : /입고일자|최초등록일/.test(name) ? '「23-9-21」·「2025. 3. 25」는 「2023-09-21」 꼴로. 날짜 아닌 글자는 안 옮긴다'
            : name === '연료' ? '휘발유→가솔린 · EV→전기 · 경유→디젤로 맞춘다'
              : name === '분류' ? '신차/재렌트/구독 표기를 신차렌트·중고렌트·신차구독·중고구독으로 맞춘다'
                : isAi ? '차종마스터 정제칸 — fill-supplier-ai-columns 가 빈 칸만 채우고, 사람이 고친 값은 안 덮는다' : '';
    R(name, OWNER_LABEL[owner], from, note);
  }
  R('', '', '', '');
  R('4. 여기서 고치는 것 / 원본에서 고치는 것', '', '', '');
  R('여기서', '정제칸(행키·기본스펙·차종코드~차종분류) · 정책코드 · 정책 탭 · 색/연식/주행거리/차량가격 같은 «처음 한 번» 칸(옮겨 온 뒤로는 우리 기록 — 미러가 되돌리지 않는다)', '', '');
  R('원본에서', '상태 · 기간별 대여료 · 보증금 · 차명(세부모델+트림) · 옵션 — 여기서 고쳐도 다음 미러가 원본 값으로 되돌린다. 틀리면 공급사에 원본을 고쳐 달라고 한다.', '', '');
  R('하지 말 것', '줄 지우기(그 차의 정제 작업이 같이 사라진다 — 안 파는 차는 상태만 출고불가) · 열 이름 바꾸기·옮기기(이름으로 읽는다) · 판매시트에서 고치기(다음 발행에 사라진다)', '', '');
  R('', '', '', '');
  R(`5. ${m.name} 특이사항`, '', '', '');
  for (const n of (NOTES[m.code] || [])) R('', n, '', '');
  R('', '', '', '');
  R('6. 정책 탭', '', '', '');
  R('', '한 줄이 정책 하나. 첫 줄 「(프리패스 기본)」, 그 아래가 이 공급사 정책. 재고 「정책코드」가 그 줄을 가리킨다. 표기 규격은 머리글 메모(빨간 삼각형)·docs/SUPPLIER_POLICY_SHEET_MANUAL.md.', '', '');
  R('', m.policies ? '이 공급사는 원본 줄에 조건 칸이 있어 기계가 접어 넣는다 — 같은 조건이면 한 줄, ERP 에 같은 조건 정책이 있으면 그 코드를 쓴다. 손으로 고친 값은 다음 정책 미러가 다시 쓴다(원본을 고치는 게 맞다).' : '이 공급사는 원본에 조건 칸이 없다 — 정책 줄은 사람이 관리한다(기계가 안 덮는다).', '', '');
  R('', '', '', '');
  R('7. 구글시트 기능(IMPORTRANGE 등)으로 직접 걸 때 — 함정', '', '', '');
  R('', 'IMPORTRANGE 는 원본의 **숨긴 줄을 못 가른다**(코드 미러는 숨긴 줄=안 파는 차로 본다). 수식으로 걸면 「상태」 열 값으로만 판단하게 된다 — 공급사가 줄을 숨기고 상태를 안 바꾸면 그 차가 판매시트에 산다.', '', '');
  R('', '정제칸(차종코드~차종분류)·정책코드는 우리가 적는 값이다. 재고 탭을 통째로 수식으로 채우면 원본에 줄이 늘거나 순서가 바뀔 때 우리 값이 다른 차에 붙는다 → 우리 칸은 「차량번호」를 열쇠로 한 별도 탭에 두고 VLOOKUP/XLOOKUP 으로 끌어오거나, 앞쪽(공급사 칸)만 수식으로 하고 정제칸은 값으로 둔다.', '', '');
  R('', '값 규격화(2번)는 수식이 안 해 준다 — 상태 열은 SWITCH/REGEXMATCH 로 위 표대로 바꾸거나, 원문을 그대로 두고 판매시트 발행기(원문을 그대로 실음)를 믿는다. 날짜는 TEXT(…, "yyyy-mm-dd") 로.', '', '');
  R('', '머리행 이름을 바꾸지 말 것 — 발행기·ERP 파서·정제칸 채우기 전부 **이름**으로 읽는다(자리 아님). 오토플러스 주행 구간 열은 「12개월3만」 꼴 그대로.', '', '');
  R('', '표(Table)·칩 드롭다운 안에 수식 결과가 들어가면 목록 밖 값에 빨간 삼각형이 뜬다(막지는 않는다). 첫 IMPORTRANGE 는 셀에서 「액세스 허용」을 한 번 눌러야 한다(pyh@teamjpk.com 으로).', '', '');
  R('', '수식 연동을 켠 뒤에는 코드 미러(mirror-sources.ts)에서 이 공급사를 빼고, 이 탭 「지금 연동」 줄을 고쳐 둔다 — 두 길이 같이 돌면 서로 덮는다.', '', '');
  R('', '', '', '');
  R('8. 권한', '', '', '');
  R('', '팀제이피케이(teamjpk.com) 편집. 링크는 보기 전용이 원칙(자체시트 공급사는 여기에 적을 일이 없다). ERP 서비스계정 읽기.', '', '');
  R('', `마지막 갱신 ${new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')} KST · npx tsx scripts/publish-mirror-guide-tab.mts --apply`, '', '');
  return rows;
}

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const rgb = (hex: string) => ({ red: parseInt(hex.slice(0, 2), 16) / 255, green: parseInt(hex.slice(2, 4), 16) / 255, blue: parseInt(hex.slice(4, 6), 16) / 255 });
const targets = MIRROR_SOURCES.filter((m) => !ONLY.size || ONLY.has(m.code));
console.log(`■ 「${TAB}」 ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳`);
for (const m of targets) {
  const meta = await call(`${SH}/${m.to}?fields=properties.title,sheets.properties(sheetId,title,index)`);
  const props = (meta.sheets || []).map((x: Rec) => x.properties);
  const stock = props.find((p: Rec) => S(p.title) === '재고');
  const hv = await call(`${SH}/${m.to}/values/${encodeURIComponent("'재고'!A1:BZ3")}`) as { values?: string[][] };
  const grid = (hv.values || []).map((r) => r.map(S));
  const hi = grid.findIndex((r) => r.some((c) => c.replace(/\s+/g, '') === '차명(세부모델+트림)'));
  const header = hi >= 0 ? grid[hi] : [];
  const maps = await tabMaps(m, header, call);
  const rows = await buildRows(m, header, maps);
  const old = props.find((p: Rec) => S(p.title) === OLD_TAB);
  console.log(`  ${APPLY ? '✓' : '→'} ${m.name} 「${S(meta.properties?.title)}」 — ${rows.length}줄 · 재고 ${header.filter(Boolean).length}열 · 원본 탭 ${maps.filter((t) => !t.hidden).length}${old ? ` · 「${OLD_TAB}」 탭 삭제` : ''}${stock ? '' : ' · ⚠ 재고 탭 없음'} · 숨김`);
  if (!APPLY) continue;
  let gid = props.find((p: Rec) => S(p.title) === TAB)?.sheetId;
  const reqs0: Rec[] = [];
  if (gid === undefined) reqs0.push({ addSheet: { properties: { title: TAB, gridProperties: { rowCount: rows.length + 10, columnCount: 4 } } } });
  if (old) reqs0.push({ deleteSheet: { sheetId: old.sheetId } });
  if (reqs0.length) {
    const res = await call(`${SH}/${m.to}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs0 }) });
    if (gid === undefined) gid = res.replies?.[0]?.addSheet?.properties?.sheetId;
  }
  await call(`${SH}/${m.to}/values/${encodeURIComponent(`'${TAB}'!A1:Z${Math.max(200, rows.length + 30)}`)}:clear`, { method: 'POST', body: '{}' });
  await call(`${SH}/${m.to}/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: rows }) });
  const reqs: Rec[] = [
    { repeatCell: { range: { sheetId: gid }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE }, wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(textFormat,wrapStrategy,verticalAlignment)' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: 12, bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
    ...[190, 460, 260, 420].map((px, i) => ({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } })),
    // ★숨김 — 사장님 「매뉴얼만 잘 만들어 놔, 탭에 숨겨서」. 사람은 보기 → 숨긴 시트에서 연다.
    { updateSheetProperties: { properties: { sheetId: gid, tabColor: rgb('FDE9D9'), hidden: true }, fields: 'tabColor,hidden' } },
  ];
  rows.forEach((r, i) => { if (i > 0 && /^\d\./.test(r[0])) reqs.push({ repeatCell: { range: { sheetId: gid, startRowIndex: i, endRowIndex: i + 1, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: rgb('D9E7FD'), textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE, bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } }); });
  await call(`${SH}/${m.to}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
}
console.log(APPLY ? '반영 완료' : '※ dry-run. 반영은 --apply');
