/**
 * 업무 화면 UI 계약 가드.
 *
 * 페이지·기능 코드는 공용 UI 원자를 사용한다. raw 컨트롤은 브라우저 네이티브 동작이
 * 실제 기능에 필요한 경우만 파일·태그·개수까지 고정해 허용한다. 숫자 radius는 페이지마다
 * 미묘하게 달라지는 원인이므로 업무 화면에서는 R만 허용한다(0은 사각 표·스켈레톤 경계).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROOTS = ['app', 'components', 'features'];
const RAW = new Set(['button', 'input', 'select', 'textarea']);

type Allow = { reason: string; counts?: Partial<Record<string, number>>; all?: boolean };

const RAW_ALLOW = new Map<string, Allow>([
  ['app/global-error.tsx', { all: true, reason: '루트 레이아웃·globals.css까지 실패한 독립 최종 방어선' }],
  /* app/login/page.tsx 는 2026-08-30 에 공용 원자로 갈아 raw 0 이 됐다(도면 §4 1순위).
     원자 높이(32/40)와 충돌해 예외였던 자리인데, CTRL 에 lg(44/48)를 더해 해소했다.
     ★다시 raw 를 쓰기 시작하면 여기 예외를 되살리지 말고 원자를 고칠 것. */
  ['app/m/page.tsx', { all: true, reason: '업무 화면이 아닌 모바일 프로모션 미리보기 섬' }],
  /* 손님 서명 화면은 착한거래 규격이라 ERP 원자를 «안 쓰는 게» 규격이다(docs/ESIGN-UIUX-SPEC.md).
     raw 는 sign.css 의 .btn/.auth-opt/.sagree/.field 가 제 규격으로 입힌다 —
     ERP 원자가 섞이지 않았는지는 check-esign-uiux 가 매번 「ERP 원자 0개」로 확인한다. */
  ['app/sign/[token]/page.tsx', {
    counts: { button: 14, input: 4, select: 2 },
    reason: '착한거래 규격 화면 — 단계 버튼·숨김 파일 선택기(신분증·얼굴·추가운전자 면허증·요청서류)·선택 칸',
  }],
  /* 견적(`/estimate`)의 화면 정본은 **웰릭스 테이블**이다(사장님 2026-09-07 「야 일단 웰릭스 테이블을
     **그대로 복사**해와봐」 · 「거기서 **신차에서 중고차로만 변환**하고 **원가구조만 다르게** 쓰면 되는 거잖아」).
     ⇒ 마크업이 원본 것이라 업무동 원자를 쓸 수 없다 — 원자를 끼우는 순간 «그대로»가 깨진다.
       입히는 것은 `components/estimate/welrix.css`(원본 `<style>` 을 한 글자도 안 고치고 `.wx-root` 에 가둔 것).
     raw 를 세면 이렇게 된다 —
       button 5  = 「원가 펼치기」 + 「연도별 잔가」 접기 머리 + 고르는 도우미 셋(`Seg`·`Chips`·`TChips`)
                   ★잔가 머리는 2026-09-08 에 생겼다 — 사장님 「잔가 수동 넣기는 **숨겨놨다가 꺼내서**
                     쓸 수 있는 거고」 · 「**원가페이지에 들어갈 거는 안 보여주는** 거야」.
                   ★2026-09-08 사장님 「**기존거 활용하라고 했는데**」 — 새 원자를 만들지 않고
                     기존 `.seg`·`.chips`·`.tchips`(estimate.css / picker.css) 규칙을 그대로 쓴다.
                     그래서 마크업은 이 파일 안에 있고, «규격»은 기존 CSS 한 곳이 쥔다.
                   ★2026-09-08 에 **일곱에서 하나로 줄었다** — 사장님 「저렇게 굵을 필요 없고」로
                     상품 카드 여섯과 「차종 고르기」 단추를 걷고 **한 줄짜리 드롭다운**으로 바꿨다.
       input 18  = **좌(차)** 시세·연식·주행·배기량·매입할인·신차 차량가 + 옵션 체크 1
                 + **우(견적)** 공통 조건 3(보증금·선납·수수료) + 손님·담당자·연락처 3
                 + **기간 칸** 보증금·선납·견적잔가·인수잔가 4 (다섯 칸이 이 넷을 되쓴다)
                   … 원본 `.cs-field`/`.qc-field`/`.pin`/`.pct-cell`/`.option-row` 짜임
       select 2  = **색상 외장·내장**
                   ★고르는 방식은 «목록 길이»가 정한다(2026-09-08 오후 확정) —
                     두셋 = 버튼(상품·채널·만기·신용·취득) · 여럿 = 드롭다운(차종 넷 · 색상)
                     칩으로 펴면 열일곱·수십·열둘이 왼쪽을 두세 줄씩 먹는다.
     ★2026-09-08 오후 — 잔가가 «왼쪽 다섯 칸»에서 «기간 칸 안 두 값»으로 옮겨졌다
       (견적용 / 손님 인수용 — 사장님 「잔가는 내부에서 **견적용 잔가와 손님 인수용 잔가가 2개**가 있음」).
       수수료도 「손님·담당자」 줄에서 «② 공통 조건»으로 옮겼다 — 손님 정보가 아니라 견적 조건이다.
     ⚠ 숫자가 달라지면 화면이 «원본에서» 벗어났다는 뜻이다. 고치기 전에 **원본과 대조**할 것
       (`C:\dev\welrixtable/index.html` · `src/components/*.vue`). */
  /* ★2026-09-09 입력 19 — 옵션 «조합 규칙»판이 붙으면서 체크칸이 한 벌 더 생겼다
     (사장님 「옵션은 명확하게 다 구현하는 게 웰릭스 테이블에 있는데」).
     규칙이 있는 트림은 규칙판(배타 택1·선행·배제), 없는 트림은 옛 평면 목록 — 둘이 같이 산다.
     ⚠ 규칙 없는 트림을 못 고르게 만들면 «못 받은 것»이 «없는 것»이 되므로 평면 목록을 안 걷는다. */
  ['app/estimate/page.tsx', {
    counts: { button: 5, input: 19, select: 2 },
    reason: '견적 = 웰릭스 테이블 그대로 — 상품 카드·차종·**선택 옵션·색상**·차량정보·잔가·손님/담당자·조건·발송용 견적 + «견적서 보기»',
  }],
  /* 손님 견적서(`features/estimate/QuotePreview`) — 웰릭스 원본 `.quote-modal`/`.qd-*` 마크업 그대로다.
     ⚠ 원자를 끼우면 원본 CSS 가 기다리는 «속 짜임»이 깨진다(`.qd-people__col` 은 h4+.name 을 기다린다).
     button 2 = 「인쇄 · PDF」 + 「닫기 ✕」 — 모달 머리 둘뿐이고, 문서 본문에는 누를 것이 없다.
     ⚠ 늘면 「손님 문서에 «누르는 것»이 생겼다」는 뜻이다 — 인쇄물이 될 문서라 먼저 그게 맞는지 본다. */
  ['features/estimate/QuotePreview.tsx', {
    counts: { button: 2, input: 0, select: 0 },
    reason: '손님 견적서 — 웰릭스 견적서 마크업 그대로(모달 머리 인쇄·닫기 둘)',
  }],
  /* 원가 설정(`/estimate/cost`)도 같은 갈래 — 목업 `프리패스-목업-원가설정.html` 을 그대로 옮겼다.
     raw 는 `components/estimate/cost.css` 가 제 규격으로 입힌다(920px 2열·둥근 14px·그림자 — 업무동 규격이 아니다).
     button 2 = 세그(채널·신용·마스터 묶음 한 개 + 저장) · input 2 = 숫자칸(`Pin`) · 차종 검색. */
  /* 차 고르기 시트(`features/estimate/CarPicker`) — 견적 얼굴의 조각이라 업무동 원자를 쓰지 않는다.
     button 12 = 제조사 칩·목록 줄·파워트레인/트림 칩·연료 세그·옵션 줄·닫기·이전·확정 (전부 시트 안).
     input 1 = 차종 검색칸. ⚠ 늘면 「고르는 길」이 늘었다는 뜻이다 — 걸음 둘을 넘겼는지 먼저 본다. */
  /* 차종 캐스케이드 — 원본 `VehicleCascade.vue` 를 옮긴 것이라 원자를 쓰지 않는다.
     select 1 = 걸음 한 칸(`Step`)의 드롭다운 하나. 넷은 그 한 줄을 네 번 부른 것이다.
     ⚠ 늘면 「걸음이 늘었다」는 뜻이다 — 원본은 넷(제조사→모델→세부→트림)이다. */
  /* ★2026-09-09 폰 마법사가 붙으면서 이 조각이 «두 얼굴»이 됐다 — 사장님 「모바일에서는 이거를
     **다음 다음 다음** 이렇게 하게 만들었잖아 **직관적으로**. **웰릭스 테이블에 이미 있는 내용**이고」.
       웹 = 한 줄 드롭다운 하나(`select` 1)
       폰 = 그 걸음의 목록을 «쪽 하나»로 편다 — 원본 `StepVehicle.vue` 짜임 그대로
            button 7 = 지나온 걸음 넷(`sv-crumb`) + 제조사 칸·트림 칸·목록 줄
     ⚠ 데이터를 뽑는 셈은 **여기 한 곳**이다. 폰이 따로 세면 두 화면이 어긋난다 — 그래서 한 조각에 둔다. */
  ['features/estimate/VehicleCascade.tsx', {
    counts: { button: 7, input: 0, select: 1 },
    reason: '차종 캐스케이드 — 웹은 한 줄 드롭다운, 폰은 «다음 다음 다음» 마법사 쪽(원본 StepVehicle 짜임)',
  }],
  /* 폰 견적 마법사 껍데기(`features/estimate/EstimateWizard`) — 원본 `MobileApp.vue` 마크업 그대로다.
     button 5 = 머리 「견적서」 + 상품 두 줄 + 발 「이전」·「다음/견적서 보기」.
     ⚠ 원자를 끼우면 원본 CSS(`.m-btn`·`.sv-row`)가 기다리는 짜임이 깨진다 — 견적기는 제 얼굴을 가진다. */
  ['features/estimate/EstimateWizard.tsx', {
    counts: { button: 5, input: 0, select: 0 },
    reason: '폰 견적 마법사 — 머리 견적서 · 상품 두 줄 · 발 이전/다음(원본 MobileApp 짜임)',
  }],
  ['features/estimate/CarPicker.tsx', {
    counts: { button: 11, input: 1, select: 0 },
    reason: '견적 차 고르기 시트 — 중고(차종마스터)·신차(신차마스터) 두 갈래를 한 시트에서. '
      + '★2026-09-10 에 12 → 11 로 «낮췄다» — 시트 안 «평면 옵션 목록»을 걷어낸 자리다. '
      + '그 목록은 option-rules 의 빗장 셋을 하나도 안 거쳤고 유료 색상이 colorAdd 와 두 번 더해졌다. '
      + '옵션은 왼쪽 별도 칸(#sec-options)에서만 고른다(2026-09-08 확정).',
  }],
  ['app/estimate/cost/page.tsx', {
    counts: { button: 3, input: 2, select: 0 },
    reason: '원가 면 — 세그·저장·«칸 설명 ⓘ»(3) · 숫자칸·차종 검색(2). ⓘ 는 2026-09-06 에 늘었다 — 사장님 「렌터카 처음 하는 사람들도 이 구조를 이해해서 … 커서를 갖다 대면 설명」',
  }],
  /*
   * ★★**손님 동(가게)은 «제 원자층»을 갖는다** — `components/shop/shop-ui.tsx`.
   *   사장님 2026-09-04 「검색창이고 좌측 사이드바 필터하고 **기존 거 활용하지 말고 새로이** 설계하고」.
   *   업무동 원자는 «하루 종일 콕핏을 보는 사람» 규격(높이 32·글자 12~13·각진 모서리 4)이고,
   *   손님은 «한 번 훑고 고르는» 사람이라 타깃·글자·둥글기가 다르다. 전자계약·견적과 같은 갈래다.
   * ⚠ 그래서 이 파일의 raw 는 «원자의 본체»다(components/ui 와 같은 지위 — sign/atoms 와 같음).
   *   나머지 손님 동 파일은 **shop-ui 원자를 써야 한다** — 개수를 못 박아 새 raw 는 계속 걸리게 둔다.
   * ⚠⚠ 2026-09-06 검수 — 하단 실행독이 세 곳에 손으로 짜여 높이가 54·52·48 로 갈렸고 둘은
   *   아이폰 안전영역을 안 봤다. `ShopDock`·`ShopDockAction` 원자로 합쳤다. **다시 손으로 짜지 말 것.**
   */
  ['components/shop/shop-ui.tsx', {
    counts: { button: 6, input: 2, select: 1 },
    reason: '가게 «원자 파일» 자체 — ShopPill·ShopIconBtn·ShopTextBtn·ShopDock/ShopDockAction·ShopSearch·ShopSort 의 본체',
  }],
  ['components/shop/ShopDetail.tsx', {
    counts: { button: 5 },
    reason: '상세 — 기간 고르는 줄(접근성상 진짜 button)·사진 갤러리 타일·갤러리 좌우 화살표'
      + '·썸네일 칸 위아래 화살표(2026-09-07 — 갤러리 화살표와 같은 종류, 사진 넘기는 손잡이)'
      + '·공유. 나머지는 shop-ui 원자',
  }],
  ['components/shop/ShopFilters.tsx', {
    counts: { button: 2 },
    reason: '조건칸 — 축 접기 머리·줄 전체가 누름 영역인 체크 줄(줄 자체가 컨트롤이라 원자로 못 감싼다)',
  }],
  ['components/shop/ShopFilterSheet.tsx', {
    counts: { button: 1 },
    reason: '폰 조건 시트 — 축 고르는 왼쪽 기둥. 하단독은 ShopDock 원자다',
  }],
  ['components/WhitelabelFrame.tsx', {
    counts: { button: 1 },
    reason: '채널 껍데기 — 안내 띠 닫기. 하단 전화독은 ShopDock 원자다',
  }],
  /*
   * ⚠⚠ **2026-09-07 — 이 블록이 통째로 «두 번» 붙어 있었다**(주석까지 그대로).
   *   `new Map([...])` 은 **뒤엣것이 이긴다.** 그래서 앞 블록은 죽은 코드였고,
   *   거기 숫자를 고쳐도 검사는 꿈쩍도 안 했다(썸네일 화살표를 더하면서 실제로 겪었다).
   * ★같은 키를 두 번 적지 마라 — 고친 사람은 고쳤다고 믿고, 검사는 옛 값을 본다.
   *   그게 제일 나쁜 종류다(둘 다 «맞다»고 말한다).
   */
  ['components/sign/atoms.tsx', {
    counts: { button: 2, input: 1 },
    reason: '착한거래 «원자 파일» 자체 — SignOption·SignConsent·SignInput 의 본체(components/ui 와 같은 지위)',
  }],
  ['components/ContractDocs.tsx', { counts: { input: 1 }, reason: '숨김 파일 선택기' }],
  ['components/ChatThread.tsx', { counts: { button: 3, input: 1, textarea: 1 }, reason: '첨부 목록 토글·사진 확대·앨범 타일·숨김 파일 선택기·브라우저 자동완성 방지 채팅 입력기' }],
  ['components/ConsultPanel.tsx', { counts: { input: 1 }, reason: '드롭존과 연결된 숨김 다중 파일 선택기' }],
  ['components/PhotoUpload.tsx', { counts: { input: 1 }, reason: '숨김 사진 선택기' }],
  ['features/inventory/InventoryEditorPanes.tsx', { counts: { input: 1 }, reason: '숨김 OCR 파일 선택기' }],
  ['app/settlement/page.tsx', { counts: { input: 1 }, reason: '숨김 정산 엑셀 선택기' }],
  /**
   * 우클릭 메뉴 한 장 안에서 «상세 보기»는 <a>, «ERP 상세 미연결»은 <span>, 복사 둘은 <button>이다.
   * 셋이 .fp-sheet-view__context-action 한 클래스로 **똑같이 보여야** 하는데, Btn은 bare에서도
   * padding·background·display를 인라인으로 덮어써 클래스를 이긴다 — 원자를 넣으면 그 줄만 어긋난다.
   * 개수를 2로 못 박아 새 raw 컨트롤은 계속 걸리게 둔다. 갚을 빚: components/ui/ContextMenu SSOT 로 옮긴다.
   */
  ['features/finder/SheetView.tsx', { counts: { button: 2 }, reason: '한 클래스로 <a>·<span>과 같은 모양이어야 하는 우클릭 메뉴 항목' }],
]);

// 기능상 native 요소가 필요한 명시 예외: 파일 선택기와 이미지 갤러리의 행/셀 버튼.
RAW_ALLOW.set('components/ChatThread.tsx', { counts: { button: 3, input: 1, textarea: 1 }, reason: '첨부 파일 선택기·갤러리 행/셀 버튼·채팅 입력기' });
RAW_ALLOW.set('components/ConsultPanel.tsx', { counts: { input: 1 }, reason: '상담 첨부 드롭존의 숨김 파일 선택기' });

const RADIUS_ISLANDS = new Set([
  'app/global-error.tsx',
  'app/m/page.tsx',
]);

const hits: string[] = [];

// 비로그인 둘러보기는 폐기된 진입면이다. 오래된 브랜치 병합으로 버튼이나 guest 인증 우회가
// 되살아나면 상품·회원 화면이 인증 없이 열릴 수 있으므로 UI 게이트에서 함께 차단한다.
const loginSource = readFileSync(join(ROOT, 'app/login/page.tsx'), 'utf8');
const authContextSource = readFileSync(join(ROOT, 'lib/auth-context.tsx'), 'utf8');
if (/로그인 없이 둘러보기|\bdoGuest\b|\bsetGuest\s*\(/.test(loginSource)) {
  hits.push('app/login/page.tsx: 폐기된 비로그인 둘러보기 진입이 다시 추가됨');
}
if (/const\s+authed\s*=.*\bisGuest\s*\(/.test(authContextSource)) {
  hits.push('lib/auth-context.tsx: guest 플래그를 인증 세션으로 인정하면 안 됨');
}

function rel(path: string) {
  return relative(ROOT, path).replace(/\\/g, '/');
}

function walk(dir: string, out: string[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.next', 'data'].includes(entry.name)) walk(path, out);
    } else if (/\.tsx$/.test(entry.name)) {
      out.push(path);
    }
  }
}

const files: string[] = [];
for (const root of ROOTS) walk(join(ROOT, root), files);

for (const path of files) {
  const file = rel(path);
  const source = readFileSync(path, 'utf8');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // components/ui 배럴은 'use client' 경계다. 서버 컴포넌트가 여기서 C/FW 같은
  // 객체 토큰을 꺼내 속성 접근하면 배포 런타임에서 client reference 직렬화 오류가 난다.
  const clientComponent = /^\s*['"]use client['"];/.test(source);
  if (file.startsWith('app/') && !clientComponent && /from\s+['"]@\/components\/ui['"]/.test(source)) {
    hits.push(`${file}: 서버 컴포넌트의 client UI 배럴 import → 토큰은 components/ui/tokens, 컴포넌트는 리프 모듈 사용`);
  }

  // aria-* 속성이 여는 태그 밖으로 빠지면 JSX 텍스트가 되어 화면과 스크린리더에
  // 그대로 노출된다. 브라우저 검수에서 발견한 회귀를 정적으로 차단한다.
  const visitAriaText = (node: ts.Node) => {
    if (ts.isJsxText(node) && /\baria-[a-z-]+\s*=/.test(node.getText(sourceFile))) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      hits.push(`${file}:${line + 1}: aria-* 속성이 JSX 텍스트로 노출됨`);
    }
    ts.forEachChild(node, visitAriaText);
  };
  visitAriaText(sourceFile);

  if (!file.startsWith('components/ui/')) {
    const counts: Record<string, number> = {};
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(sourceFile);
        if (RAW.has(tag)) counts[tag] = (counts[tag] || 0) + 1;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    const allow = RAW_ALLOW.get(file);
    if (Object.keys(counts).length && !allow) {
      hits.push(`${file}: raw 컨트롤 ${JSON.stringify(counts)} → components/ui 원자 사용`);
    } else if (allow && !allow.all) {
      const expected = allow.counts || {};
      const keys = new Set([...Object.keys(counts), ...Object.keys(expected)]);
      for (const tag of keys) {
        if ((counts[tag] || 0) !== (expected[tag] || 0)) {
          hits.push(`${file}: 허용 raw ${tag} 개수 변경 ${counts[tag] || 0}/${expected[tag] || 0} — 예외 근거 재검토 필요`);
        }
      }
    }
  }

  if (!file.startsWith('components/ui/') && !RADIUS_ISLANDS.has(file)) {
    source.split(/\r?\n/).forEach((line, index) => {
      const match = line.match(/borderRadius:\s*([0-9]+(?:\.[0-9]+)?)/);
      if (match && Number(match[1]) !== 0) {
        hits.push(`${file}:${index + 1}: 숫자 borderRadius ${match[1]} → R 사용`);
      }
    });
  }
}

// 목록 상태·선택은 좌측 색상 바에 의존하지 않는다. 상태는 아이콘·배지·카운트,
// 선택은 C.selected 배경이라는 모바일/웹 공통 목록 SSOT를 정적 게이트로 고정한다.
const feedRowSource = readFileSync(join(ROOT, 'components/ui/feedrow.tsx'), 'utf8');
const listRowsSource = readFileSync(join(ROOT, 'components/list-rows.tsx'), 'utf8');
if (/\baccent\s*\??:\s*BadgeTone|boxShadow\s*:\s*accent/.test(feedRowSource)) {
  hits.push('components/ui/feedrow.tsx: 목록 좌측 accent 바 금지 — 상태는 아이콘·배지·카운트 사용');
}
if (/\baccent\s*=/.test(listRowsSource)) {
  hits.push('components/list-rows.tsx: FeedListRow 좌측 accent 바 전달 금지');
}

// data-fp-m은 첫 페인트 힌트일 뿐이며 마운트 후 판정은 실제 viewport를 따라야 한다.
// 그렇지 않으면 회전·리사이즈 시 데스크톱 패널이 모바일 폭에 압축된다.
const mobileSource = readFileSync(join(ROOT, 'lib/use-mobile.ts'), 'utf8');
const liveWidthReader = mobileSource.match(/function readWidthMobile[\s\S]*?\n}/)?.[0] || '';
if (!liveWidthReader.includes('window.innerWidth') || liveWidthReader.includes('dataset.fpM')) {
  hits.push('lib/use-mobile.ts: 마운트 후 모바일 판정은 data-fp-m이 아닌 현재 window.innerWidth를 사용');
}

// 문의→계약 이동은 같은 권한 스코프의 계약 캐시를 즉시 보여주고, 목록과 무관한 정산 read가
// 계약 행 표시를 막지 않아야 한다. 모바일 탭 전환이 매번 skeleton으로 돌아가는 회귀를 막는다.
// (2026-08-19 사장님: 계약진행=/contract 는 목록+5단계 진행 화면으로 복귀. 전자계약은 /esign 계약서관리 하나.)
const contractPageSource = readFileSync(join(ROOT, 'app/contract/page.tsx'), 'utf8');
if (!contractPageSource.includes("peekList('contract', co)")) {
  hits.push('app/contract/page.tsx: 같은 세션 계약 캐시로 목록 첫 페인트 유지');
}
const contractRowsReadyAt = contractPageSource.indexOf('setRows(mine);');
const settlementBackgroundAt = contractPageSource.indexOf('void settlementsP.then');
if (contractRowsReadyAt < 0 || settlementBackgroundAt < 0 || contractRowsReadyAt > settlementBackgroundAt) {
  hits.push('app/contract/page.tsx: 계약 목록 표시는 정산 선조회 완료보다 먼저 처리');
}
// 계약서관리(/esign)는 EsignSendCenter 하나가 목록 데이터를 직접 읽는다 — 페이지에서 엔진을 복제하지 않는다.
// 서버가 새 direct 계약을 만든 직후에는 cache health를 확인해 fresh read를 할 수 있으므로,
// `getStore().list(...)` 한 줄 형태가 아니라 같은 store 인스턴스의 목록 read를 확인한다.
const esignCenterSource = readFileSync(join(ROOT, 'components/EsignSendCenter.tsx'), 'utf8');
if (!esignCenterSource.includes('const store = getStore()')
  || !esignCenterSource.includes("store.list('contract', companyId)")) {
  hits.push('components/EsignSendCenter.tsx: 계약 목록 데이터 직접 조립 유지');
}

if (hits.length) {
  console.error(`✗ UI 계약 드리프트 ${hits.length}건\n\n${hits.map((hit) => `  ${hit}`).join('\n')}`);
  process.exit(1);
}

console.log('✓ UI 계약 드리프트 0 — 공용 컨트롤·radius 및 명시 예외 정합성 유지');
