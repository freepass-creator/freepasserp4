/**
 * **AI 운영 매뉴얼 — 어떤 AI(Claude·Gemini·Cursor·Codex·사람)가 와도 같은 방식으로 일하기 위한 한 장.**
 *
 * ★사장님 2026-08-18 — 「매뉴얼 확실하게 박아 주라, 어떤 AI가 와도 이렇게 작업될 수 있게끔 — 각 시트에 다 박아 놓자」.
 *   이 파일이 정본이고, 모든 시트의 「AI 운영 매뉴얼」 탭과 docs/AI_OPERATING_MANUAL.md 는 여기서 찍은 사본이다(`scripts/publish-ai-manual-tab.mts --apply`).
 *   탭을 손으로 고치지 말고 이 파일을 고쳐 다시 찍는다 — 그래야 20여 장이 갈리지 않는다.
 * ★글은 개조식·짧게. 근거가 되는 코드 파일과 명령을 같이 적는다 — «어디를 열어 보면 되는지»가 매뉴얼의 값어치다.
 */
import { AI_TOUCH_RULES } from './ai-touch-rules';
import { SHEET_READING_RULES } from './sheet-reading-rules';
import { VEHICLE_REFINE_FLOW } from './vehicle-refine-flow';
import { MIRROR_SOURCES } from './mirror-sources';
import { SHEET_ERP_PARITY_RULES, SHEET_ERP_PARITY_SUMMARY, SHEET_ERP_PARITY_VERSION } from './sheet-erp-parity';

export type ManualRow = [string, string, string];
export type ManualSection = { title: string; rows: ManualRow[] };

const IDS = {
  원천대장: '1T_RrErmGoj_yG9S1u7n--2NDolTOw8wA8ROQjPWuAlg',
  판매시트: '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs',
  문패: '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY',
  허브: '1cRn_XbuJXQMlVCATtDN4EpQy-KVEi65tCwcvCxdFk8w',
};
const url = (id: string, gid?: number) => `https://docs.google.com/spreadsheets/d/${id}/edit${gid !== undefined ? `#gid=${gid}` : ''}`;

export const AI_MANUAL_TITLE = 'AI 운영 매뉴얼';
export const AI_MANUAL_VERSION = '2026-08-20 v12';

export function buildAiOperatingManual(): ManualSection[] {
  return [
    { title: '0. 이 문서', rows: [
      ['무엇', '프리패스 재고·차종·판매시트 운영을 «어떤 AI가 와도 같은 방식으로» 하기 위한 운영 매뉴얼. 정본은 리포 `lib/domain/ai-operating-manual.ts`, 이 탭은 그 사본(모든 시트에 같은 글).', `버전 ${AI_MANUAL_VERSION}`],
      ['먼저 할 일', '① 이 탭을 끝까지 읽는다 ② 원천대장 「시트 지도」·리포 IMPLEMENTATION_LOG.md 최근 날짜를 읽는다 ③ 손댈 시트의 안내 탭(「작성 안내」/「정제시트 안내」)을 읽는다 ④ 무엇이든 쓰기 전에 dry-run 을 먼저 본다.', 'C:\\dev\\freepasserp4 · 자격증명 tmp/firebase-auth/sa.json(pyh@teamjpk.com 위임)'],
      ['원칙 3', '값은 한 곳에만 산다(정본이 이긴다) · 지어내지 않는다(모르면 빈칸·목록) · 쓰기 도구는 전부 dry-run 기본, `--apply` 로만 쓰고 되돌릴 로그를 남긴다.', ''],
    ] },
    { title: '1. 시트 지도(요약) — 정본은 원천대장 「시트 지도」 탭', rows: [
      ['공급사 시트 21곳', '「MMDD 공급사 프리패스 재고 [제공|정제]」. 제공 17 = 우리가 만들어 주고 공급사가 직접 적는다(=원본=정제시트). 정제 4 = 공급사 자체 시트·홈페이지(원본)를 우리가 옮겨 담는다(아이카·오토플러스·이안카·아이언, `lib/domain/mirror-sources.ts`). 탭: 재고(구독재고) · 정책 · [숨김]AI 인계 · 작성 안내/정제시트 안내 · AI 운영 매뉴얼 · 이 시트는.', '드라이브 검색 「프리패스 재고」'],
      ['★시트 상태 표기(2026-08-19)', '지금 읽는 시트 21곳 = 이름 끝 「[연동중]」. 옛 우리 시트(옛 제공시트 15·옛 문패·옛 판매시트·옛 공급사 상품리스트 = 18곳, `lib/domain/legacy-sheets.ts`) = 이름 앞 「[구버전·폐기]」 + 첫 탭 「⚠ 구버전 — 안 씀」(지금 쓰는 시트 링크) — 아무도 안 읽는다. 외부(공급사 소유) 원본은 이름을 건드리지 않고 원본으로만 안다(mirror-sources). 시트마다 「이 시트는」 탭 = 상태·구성(탭·열)·바라보는 곳·주는 곳·주기·고치는 곳(정본 `lib/domain/sheet-identity.ts`). 전 시트 명부는 원천대장 「시트 지도」 0장.', 'rename-supplier-sheets --apply(연동중) · retire-legacy-sheets --apply(구버전) · publish-sheet-identity-tab --apply · publish-sheet-map-tab --apply'],
      ['문패 「공급사시트정리」', '공급사코드 → 발행기·상품마스터가 읽을 시트 주소. 21곳 전부 우리 시트를 가리킨다(2026-08-18).', url(IDS.문패)],
      ['판매시트 「프리패스 상품리스트」', '영업자가 보는 표 — 기계가 찍는 사본, 손으로 고치지 않는다. ★기본 세팅(사장님 2026-08-19 확정 「이제 이게 기본 세팅이야」) = 탭 3개: 「상품리스트 …」(21곳 − 오플 − 손오공 구독, 출고불가 제외) · 「손오공구독 …」·「오플구독 …」 — 같은 발행기·같은 정본 차명이지만 우리 공통 대여료 블록(단기보증·1개월·12개월·장기보증·24~60개월) 대신 **그 공급사의 기간별 대여료**가 그 자리에 선다(손오공: 보증금 반납형(연수×대여료)·12~60개월 반납형·보증금 인수형·36/48/60개월 인수형 / 오플: 12개월 2만km·12개월 3만km·18…36개월 3만km). 같은 차는 한 탭에만. 표준 칸은 별칭으로 되찾는다(sales-published-tabs.ts). [숨김] AI 인계(@매핑=열 구성 정본·@제외) · AI 정제(치환 사전) · 이 시트는.', url(IDS.판매시트)],
      ['원천대장 「ERP4 차종마스터 원천대장」', '차종마스터(원장, Gemini) · 차종마스터_규격검토/규격채택 · 상품마스터(차량번호→차종코드, ERP 입력, 코드 규격 50열) · 상품 차종매칭(조회 뷰) · 시트 지도 · 공급사연동 · 공급사 데이터 매뉴얼 · 정제칸 대조.', url(IDS.원천대장)],
      ['리포 파일', 'data/product-vehicle-review-decisions.json(3축 결정) · public/data/vehicle-trim-master.json(artifact) · lib/domain/mirror-sources.ts(정제시트 원본표) · lib/domain/supplier-template-sheet.ts(공급사 시트 표준) · lib/domain/sales-sheet-mapping.ts(판매시트 열·별칭·제외) · lib/domain/product-master-sheet.ts(상품마스터 열).', 'C:\\dev\\freepasserp4'],
      ['정제시트 원본표', MIRROR_SOURCES.map((m) => `${m.name}(${m.code}) ← ${m.kind === 'iron' ? 'ironrentcar.com' : `시트 ${m.from}`}`).join(' · '), '수식 연동을 켜면 그 공급사를 표에서 뺀다(둘이 서로 덮는다)'],
    ] },
    { title: '2. 정본 서열 — 무엇이 어디의 정본인가', rows: [
      ['재고·상태·대여료·보증금', '공급사 시트 재고 탭(제공 = 공급사가 적은 것 · 정제 = 원본 미러). 판매시트·상품마스터는 사본 — 거기서 고치면 다음 발행에 사라진다.', '틀리면 공급사 시트(정제시트는 원본)에서'],
      ['차명(제조사·모델·세부모델·세부트림)', '차종마스터(사전) → 상품마스터 차종코드+3축 결정(차량번호 정본) → 공급사 시트 정제칸 → 판매시트. 글자 스냅으로 매번 다시 맞히지 않는다 — 한 번 정본에 박는다.', '아래 3장'],
      ['정책(보험·연령·주행·분납…)', '공급사 시트 「정책」 탭 한 줄이 정책 하나, 재고 「정책코드」로 조인. 표기 규격 `policy-value-spec.ts`. 비면 「(프리패스 기본)」.', '판매시트 정책 43열은 여기서 나간다'],
      ['열 구성', '판매시트 = AI 인계 @매핑(코드 SALES_MAPPING 은 예비) · 공급사 시트 = TEMPLATE_COLUMNS(28)+정제칸(11) · 상품마스터 = PRODUCT_MASTER_COLUMNS(50). 이름으로 읽는다 — 이름·차례를 바꾸지 말 것.', ''],
      ['공급사 시트 주소', '문패 「공급사시트정리」. 정제시트 원본 주소는 mirror-sources.ts.', ''],
    ] },
    { title: '2′. ★판매시트 = ERP — 맞추는 규칙(2026-08-20 사장님 확정)', rows: [
      ['한 줄 요약', SHEET_ERP_PARITY_SUMMARY, `버전 ${SHEET_ERP_PARITY_VERSION}`],
      ...SHEET_ERP_PARITY_RULES,
    ] },
    { title: '3. 차명 정제 흐름 — 차종마스터·상품마스터에 맞추고 → 정제칸에 박고 → 상품시트로', rows: VEHICLE_REFINE_FLOW.map((f) => [f.step, f.what, f.where] as ManualRow) },
    { title: '4. AI(자동화)가 적고 만지는 칸 — 이 밖의 칸을 기계가 건드리면 버그다', rows: [
      ['★공급사 시트가 읽히는 방식(2026-08-19 굳힘)', SHEET_READING_RULES.map((r) => `${r.what}: ${r.how}`).join(' / '), 'lib/domain/sheet-reading-rules.ts · 작성 안내·정제시트 안내 0장'],
      ['★같은 줄 어긋남 방지(2026-08-19 사고 후)', '① 표(Table)를 끝 열까지(extend-supplier-table) — 정렬해도 줄 전체 이동 ② 선택옵션·외장/내장색상은 매일 그 줄 원문에서 다시 계산(realign-derived-cells, run-daily ①″) ③ 시트에 남은 차종코드는 원문(제조사·차명·옵션)과 맞을 때만 정본으로 믿음(fill, code-vs-name) ④ 상품마스터 확정 코드 ↔ 지금 공급사 차명 대조(audit-code-vs-supplier-name) ⑤ 공급사 시트마다 「상품시트」 탭 = 발행된 판매시트 줄 그대로(publish-supplier-preview-tabs) ⑥ 제보는 trace-plate-spec 로 5단계 추적.', 'run-daily ①″·④ · 감사 도구'],
      ...AI_TOUCH_RULES.map((r) => [r.what, r.how, r.when] as ManualRow),
    ] },
    { title: '5. 매일 순서(명령) — 이 차례로, 각각 dry-run 먼저', rows: [
      ['★한 방 오더', '공급사가 시트를 고친 것을 일괄 반영하려면 이 한 줄(②~⑤′~⑥을 차례로 돌리고 검수까지 보여 준다 · 한 단계가 실패하면 거기서 멈춘다). AI 에게는 「일일 반영 돌려」. 미리보기는 --apply 없이. 정제시트를 코드로 미러하면 --with-mirror, 발행 가드(공급사 0대)에 걸리면 확인 후 --force-shrink.', 'npx tsx scripts/run-daily.mts --apply'],
      ['① 정제시트 갱신', '정제 4곳 원본 → 정제시트(사장님 수식 연동이 돌면 생략 · 코드로 돌리면 아래).', 'npx tsx scripts/sync-mirror-all.mts --apply'],
      ['② 정제칸 채움', '차량번호 정본과 대조해 빈 칸을 채우고 어긋난 값을 바로잡는다(21곳).', 'npx tsx scripts/fill-supplier-ai-columns.mts --apply --include-mirror'],
      ['③ 못 정한 차', '코드 없는 팔 수 있는 차를 차종마스터와 대조해 결정(CODE/PARTIAL)으로 넣는다 → ② 다시. 못 정한 것은 검토 큐.', 'npx tsx scripts/resolve-unmatched-vehicles.mts --apply · plan/apply-product-master-vehicle-coverage'],
      ['④ 판매시트 발행(탭 3개)', '상품리스트(21곳 − @제외 오플·손오공 구독 · 출고불가 제외 · 빈 대여료 「-」) → 손오공구독(--only=RP012:구독 → publish-sonogong-tab: 공통 대여료 블록을 걷어 내고 그 자리에 보증금 반납형·12~60개월 반납형·보증금 인수형·36/48/60개월 인수형) → 오플구독(--only=RP023 → publish-sonogong-tab --tab=오플구독: 12개월 2만km … 36개월 3만km). 블록 기본값·표시 이름·별칭은 sales-published-tabs.ts 한 곳. 공급사 하나가 0대로 줄면 멈춘다(맞으면 --force-shrink). 발행된 표 = 세 탭의 합.', 'publish-origin-tab --apply · publish-origin-tab --only=RP012:구독 --tab=손오공구독 --at=1 --apply · publish-sonogong-tab --apply · publish-origin-tab --only=RP023 --tab=오플구독 --at=2 --apply · publish-sonogong-tab --tab=오플구독 --apply'],
      ['⑤ 상품마스터 갱신 → ERP', '문패 21곳 → 상품마스터 상태·정책·기간별 돈(차종코드·차명 잠금칸은 안 덮음) → ERP 일일 동기(02:00 KST).', 'npx tsx scripts/sync-product-master-live.mts --apply'],
      ['⑤′ 상품마스터 ← 상품리스트 맞춤(ERP 정확 일치)', '★발행된 상품리스트 값이 정본 — 상품마스터의 차량상태·1·12·24·36·48·60개월 대여료·보증금을 그 값으로 덮고 되읽어 0 어긋남을 확인한다. ERP 는 상품마스터를 읽으므로 이걸로 영업자 표 = ERP. 「-」는 비움 · 보증금은 숫자일 때만 덮음, 「무보증」은 0(비우면 ERP 가 그 기간을 뺀다) · 손오공 「연수×대여료」 글자면 계산값 유지 · 번호미정 차는 못 실림(번호 나오면 자동 합류) · 대여료만 있고 보증금 없는 기간은 ERP 가 뺀다(경고로 세어 줌 — 공급사가 단기보증/장기보증을 채워야 같아진다).', 'npx tsx scripts/sync-product-master-from-sales.mts --apply'],
      ['⑥ 검수', '돈 대조 0 · 정제칸 대조 · 양식 대조 · 빈 칸 · 상품리스트↔상품마스터 일치 게이트(어긋나면 실패).', 'audit-sheet-vs-sales · audit-vehicle-refine · audit-supplier-schema · audit-stock-gaps · sync-product-master-from-sales --audit-only'],
      ['⑦ ERP 목록 ↔ 판매시트 대조(ERP 동기 뒤)', '시트에 있는데 ERP 목록에 없는 차와 이유(상태 어긋남 · 유효가격 0 · ERP 에 없음). 상태 어긋남(ERP 만 출고불가)이 나오면 sheet-merge 규칙(상품마스터 유입은 표식 없는 출고불가를 덮음, 2026-08-19)이 배포됐는지 확인 — 미배포면 1회 허용 플래그(allow_sheet_reactivate) 후 sync-daily 재실행. 유효가격 0 은 공급사 몫(대여료·보증금 쌍) · 시트 계약중은 ERP 출고불가 투영(정상) · 번호미정은 못 실림.', 'npx tsx scripts/audit-sales-vs-erp.mts'],
      ['★당분간 ERP 연동은 AI 가 맡는다(사장님 2026-08-19)', '자동화(sheet-sync.yml main 반영·작업 스케줄러·수식 연동)를 켜기 전까지, 사장님 오더 「상품시트 동기화」/「일일 반영」 이 오면 AI 가 ① run-daily 미리보기 → --apply(시트 쪽) ② ERP 일일 동기 dry_run → 실행(curl /api/sheet/sync-daily, 시크릿 tmp/cron-secret.txt) ③ 결과 보고(발행 대수·상품마스터 변경·ERP 갱신/실패·경고 38칸류)를 한 번에 한다. ERP 쪽은 매일 02:00 KST 크론이 따로 돌므로 시트 쪽만 낮에 돌리면 밤에 자동 반영된다. 실행 기록: RTDB v4/sheet_sync_runs.', 'npx tsx scripts/run-daily.mts --apply → curl -s "https://freepasserp.com/api/sheet/sync-daily?dry_run=1" -H "Authorization: Bearer <secret>" → 같은 주소 dry_run 없이'],
      ['자동화', '.github/workflows/sheet-sync.yml(매일)·mirror-sync.yml(30분) — main 에 올라가야 돈다. 올리기 전까지는 사람/AI 가 위 차례로 돌린다.', ''],
    ] },
    { title: '6. 절대 하지 말 것', rows: [
      ['판매시트·상품마스터를 손으로 고치기', '사본이다. 다음 발행·갱신에 사라진다. 원본(공급사 시트·정본)을 고친다.', ''],
      ['표(Table) 삭제(deleteTable)', '표 안의 값까지 지운다(2026-08-18 22탭 전멸, revision 으로 복구). 서식을 다시 입힐 땐 값 스냅샷→되쓰기가 있는 `reformat-supplier-stock-tabs` 만.', ''],
      ['열 이름·차례 바꾸기 / 줄 지우기', '전부 이름으로 읽는다. 안 파는 차는 상태만 출고불가. 정제칸·정책코드는 우리 칸.', ''],
      ['공급사 원본 시트에 쓰기 / 정제시트에서 상태·대여료 고치기', '원본은 공급사 것. 정제시트의 live 칸은 다음 미러가 되돌린다.', ''],
      ['차종코드 삭제·재사용·의미 변경 / 글자 스냅만 믿고 이름 박기', '코드는 영구. 이름은 정본(코드·결정)에서만. 스냅은 정본이 없을 때 high 만.', ''],
      ['같은 차를 두 탭에 싣기 / 판매시트 @제외를 상품마스터에 쓰기', '두 벌은 사고. @제외는 판매시트 표시 규칙(상품마스터는 재고 아닌 탭만 뺀다).', ''],
      ['보증금·대여료를 규칙으로 계산해 넣기', '공급사 글자 그대로. 없으면 「-」(판매시트)·빈칸(시트).', ''],
      ['상품마스터 잠금칸·ERP/RTDB 직접 쓰기', 'ERP 반영은 상품마스터 → 일일 동기 경로만. ERP 가 영업자 표와 다르면 상품마스터를 손대지 말고 ⑤′(sync-product-master-from-sales)를 돌린다.', ''],
      ['정제시트 미러와 수식 연동을 같이 켜기', '서로 덮는다. 수식으로 걸면 mirror-sources 에서 뺀다.', ''],
      ['표기 규격 어기기', '제조사 르노·KGM(maker-display) · 상태 6값 · 분류 4값 · 연료 6값 · 날짜 YYYY-MM-DD · 정책 표기(policy-value-spec) · 시트 이름 「MMDD 공급사 프리패스 재고 [제공|정제]」.', ''],
    ] },
    { title: '7. 무엇이 틀렸을 때 어디를 고치나', rows: [
      ['★예방 규칙(2026-08-19) — 트림 근거 없으면 빈칸 · 색상은 규격 안으로', '① 트림: 공급사 원문(상품마스터 「공급사 입력 차명」·「공급사 원문보존」·결정 supplier_text)에 트림 글자가 없으면 코드/트림을 박지 않는다(변형에 트림이 하나뿐일 때만 예외). 정제칸 채우기(fill-supplier-ai-columns)는 정본에 트림이 없으면 근거 없는 스냅 트림을 비우고, 정본이 코드 없음이면 옛 코드도 비운다. 매일 ⑥ 「트림 근거 대조」(audit-trim-evidence → 원천대장 탭)에서 근거 없음·다른 트림이 0이어야 한다. 근거 없음이 나오면 사람이 보고 --demote --apply. ② 색상: 규격 12색(외장)/10색(내장) 밖은 「기타」, 별칭은 원천대장 「색상마스터」 @별칭에 사람이 적는다(publish-color-master-tab, 미매칭은 기계가 모아 줌). ERP 도 규격색으로(product-master-import applyColors, 배포 필요).', 'audit-trim-evidence [--demote --apply] · publish-color-master-tab --apply'],
      ['★제보가 왔다(차명·트림이 실차와 다름) — 처리 순서', '① 추적: 공급사 시트 차명(세부모델+트림) · 정제칸 · 상품마스터 차종코드/검증상태 · 결정 파일 · 발행 탭에서 그 값이 어디서 왔나 본다(대개 트림 없는 옛 원문에 첫 트림 t01 이 붙은 것). ② 차종마스터에서 맞는 트림 코드를 찾는다(같은 세대·연료·배기량 v 안의 t). ③ 결정 파일에 CODE 결정(제보 근거를 basis 에)을 넣고 plan → apply-product-master-vehicle-coverage --apply(가드 writer, 스냅샷 남음). ④ fill-supplier-ai-columns --apply 로 정제칸을 정본에 맞춤(코드·세부트림 바로잡힘). ⑤ 발행(run-daily ④). 공급사 시트 왼쪽 차명(세부모델+트림) 글자는 렌트사 칸이라 기계가 안 덮는다 — 공급사에 알려 고치게 한다. 실측 2026-08-19 리더스 125호1238 K8 GL3 LPG: 프레스티지(t01)→트렌디(t03).', 'plan-product-vehicle-review-decisions → apply-product-master-vehicle-coverage --report=tmp/product-vehicle-review-decisions-report.json --apply → fill-supplier-ai-columns --apply → run-daily'],
      ['ERP 목록 대수가 판매시트보다 적음', 'audit-sales-vs-erp 로 이유별로 가른다. ① ERP 만 출고불가(표식 없음) = 병합 규칙이 수기 보류로 오인 → 상품마스터 경로는 덮게 고쳤다(sheet-merge, 배포 필요) · 즉시 복구는 allow_sheet_reactivate=true 후 sync-daily ② 유효가격 0 = 대여료·보증금 쌍이 없다(공급사 시트) ③ 시트 계약중 = ERP 출고불가 투영(정상) ④ 번호미정 = 차량번호 나오면 합류.', 'audit-sales-vs-erp · sync-daily'],
      ['ERP 에 어떤 기간이 안 보임(영업자 표엔 대여료 있음)', '그 기간 보증금이 비어 있다 — ERP 는 대여료·보증금 쌍이 있어야 싣는다. 공급사 시트 단기보증(1·12)/장기보증(24~60) 을 채우게 하고(무보증이면 「무보증」이라 적게) 일일 반영. ⑤′ 경고 목록에 차번이 나온다.', 'sync-product-master-from-sales'],
      ['차 이름이 틀림', '코드 있는 차: 상품마스터 차종코드(결정 파일 CODE → plan/apply-product-master-vehicle-coverage). 코드 없는 차: 결정 파일 TRIPLE/PARTIAL 또는 resolve-unmatched-vehicles → 정제칸 채움 → 발행.', ''],
      ['마스터의 이름·기간이 틀림', '차종마스터_규격검토(Gemini) → 규격채택 재게시 → 발행.', ''],
      ['대여료·보증금·상태가 틀림', '공급사 시트(제공) 또는 원본(정제) → 발행. 판매시트에서 고치지 않는다.', ''],
      ['정책 조건이 틀림/빔', '공급사 시트 「정책」 탭(정제시트는 sync-mirror-policies 가 원본 줄에서 접어 넣음) → 발행.', ''],
      ['판매시트 열이 빠짐/자리 다름', '판매시트 AI 인계 @매핑 → publish-handover-tab → 발행.', ''],
      ['공급사 시트 양식이 어긋남', 'audit-supplier-schema → unify-supplier-columns · insert-divider-column · paint-supplier-header-owners · reformat-supplier-stock-tabs(값 보전).', ''],
      ['정제칸이 이상함', 'audit-vehicle-refine → 원천대장 「정제칸 대조」 탭 → 정본(상품마스터/결정) 고침 → fill 다시.', ''],
      ['시트가 통째로 비었다', 'restore-stock-tabs-from-revision(드라이브 revision export) — 마지막으로 차량번호가 있던 revision 에서 되살린다.', ''],
    ] },
    { title: '8. 규격 한 장', rows: [
      ['공급사 시트', '재고 탭 40열 = 렌트사 칸 28(차량번호…사진링크) │ 정책코드 · 정제칸 11. 머리 남색(렌트사)/보라(프리패스). Roboto · 표+칩 · 대여료 배경(단기 청록·장기 파랑) · 상태/분류 칩색 안 겹침. 대여료 블록만 공급사 구조 예외(손오공 구독 인수형/반납형 · 오토플러스 2만/3만).', 'supplier-template-sheet.ts'],
      ['판매시트', '탭 3개 = 상품리스트(파랑 탭) · 손오공구독(보라 탭) · 오플구독(초록 탭)(같은 발행기, 열 = AI 인계 @매핑 · 갈래 탭은 공통 대여료 블록 자리에 그 공급사 기간별 대여료 · 오플구독은 「보증금」 칸에 산출 규칙 글자 + 머리글 메모에 오플 보증금표). ★차종구분 열(사장님 2026-08-19): 연식과 Km 사이 「차종구분」 = 공급사 시트 정제칸 「차종분류」(차종마스터 규격채택 차종분류+차체형태 → 「준중형 SUV」·「준대형 세단」, 코드 없는 차는 모델 이름 스냅) — 판매시트에만 보이고 공급사 시트는 fill-supplier-ai-columns 가 자동으로 채운다. ★금액 규격(사장님 2026-08-19): 기간별 대여료·보증금·차량가격은 우측 정렬+굵게, 기간은 배경색(단기 청록·장기 파랑·인수형 보라, 길수록 짙게) — 이름 목록이 아니라 머리글 모양(N개월…/…보증…)으로 판정(sales-sheet-format isMoneyColumn·colBgFor). 「보증금 카드결제」 같은 정책 칸은 금액 아님. 글자색: 제조사(규격검토와 같은 색표) · 연료 · 외장/내장(규격색별, 색상마스터) · 구분 · 배차상태 — 차종구분은 색 없음(「과하네」). 차명 정본→정제칸→원문. 출고불가 제외. 빈 대여료 「-」. 구분 색(마젠타·초록·보라·청록)은 상태 색(파랑·주황·회색)과 안 겹침. 같은 차는 한 탭에만(@제외 RP023 · RP012:구독).', 'sales-sheet-mapping.ts · sales-sheet-format.ts'],
      ['상품마스터', '50열(차량번호…공급사 원문보존). 「상품마스터」 탭 이름·머리행을 코드와 맞춰야 ERP·갱신기가 돈다.', 'product-master-sheet.ts'],
      ['정책 표기', '만 21세까지 · 연 20,000km · 50만원/5천만원/1억5천만원 · 가능/불가/협의 · 추가운전 요금 「N인까지 · 1인당 월 M만원」.', 'policy-value-spec.ts · docs/SUPPLIER_POLICY_SHEET_MANUAL.md'],
    ] },
    { title: '9. 오늘의 교훈(2026-08-18) — 같은 실수를 반복하지 않기 위해', rows: [
      ['deleteTable 은 값을 지운다', '서식만 바꾸려다 22탭이 비었다 → revision export 로 복구. 스냅샷·되쓰기 없는 표 삭제 금지.', 'restore-stock-tabs-from-revision.mts'],
      ['탭 이름이 뒤바뀌면 코드가 즉사한다', '「상품마스터」 탭에 조회 뷰가 들어앉아 ERP·갱신기가 헤더 불일치로 멈춰 있었다. 정본 탭 이름은 코드 상수와 같아야 한다.', 'PRODUCT_MASTER_TAB'],
      ['글자 스냅만 믿으면 세대가 틀린다', '카니발→카니발 II KV-II, 스포티지 NQ5→New 스포티지 KM. 정본(코드·결정)이 먼저, 스냅은 high 만, 옵션 글자로 트림 맞추지 않기, 영어 단어를 세대코드로 잡지 않기.', 'fill-supplier-ai-columns · resolve-unmatched-vehicles'],
      ['판매시트 규칙을 상품마스터에 쓰지 않는다', '@제외(오플 전부·손오공 구독)를 그대로 쓰면 143대가 부재→출고불가가 될 뻔했다.', 'sync-product-master-live'],
      ['한 길만 둔다', '인수형 탭이 제공시트를 따로 읽어 스냅하니 상품리스트와 이름이 갈렸다 → 상품리스트 줄을 그대로 쓰는 것으로.', 'publish-sonogong-tab'],
      ['옛 시트에 표기가 없으면 공급사는 옛 시트로 돌아간다(2026-08-19)', '문패를 새 시트로 돌린 뒤에도 손오공·우리캐피탈·렌트존 옛 시트에 전환 직전까지 공급사가 적고 있었다(드라이브 revision 실측). 새 시트를 만들면 옛 것은 같은 날 「[구버전·폐기]」+첫 탭 안내를 붙인다 — 이름만으로는 북마크에 안 보인다.', 'retire-legacy-sheets · who-edits 실측은 revisions API(lastModifyingUser, 익명=링크 편집)'],
      ['ERP 가 시트보다 적으면 «수기 보류» 규칙부터 의심(2026-08-19)', '시트 512 · ERP 482. 30대가 ERP 만 출고불가(표식 없음)인데 sheet-merge 가 수기 보류로 보호해 시트가 출고가능이라 해도 영원히 안 살아났다(손오공 27·오플 2·아이카 1, 출처는 옛 경로 잔재). 상품마스터가 ERP 입력 정본이면 표식 없는 출고불가는 보류가 아니다(보류는 관리상태 중지). 검수 ⑦(audit-sales-vs-erp)을 매일 순서에 넣었다.', 'sheet-merge softMergeProduct · sheet-sync-all manualReactivations'],
    ] },
  ];
}
