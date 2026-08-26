/**
 * **정산원장 탭을 넷으로 세운다 — 접수 · 취소 · 분납실적 · 완납실적.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-25
 *   「접수 이건 그냥 계속 접수되는거로 해놔야할거 같아 당월 접수가 아니라」
 *   「접수 ← 여기서 접수를 하고 한줄한줄을 옮겨가는거로 하자」
 *   「접수는 했는데 인도가 안된건 접수에 계속 남아있는거지」 「취소탭 하나 둘까?」
 *   「접수를 받을때 거기에 청구월이 생성될거고 그 청구월기준으로 청구서에 반영하면 되는거고」
 *
 * ```
 * 접수      청구월이 없다(= 인도 전). 월로 안 자른다. 계속 쌓이고 여기서 한 줄씩 옮겨간다
 * 취소      계약 불가(취소). 인도 못 하고 끝났다 — 접수에 남겨 두면 일하는 표가 흐려진다
 * 분납실적   청구월이 있고 분납 만료가 안 지났다. 지나고 환수가 없으면 저절로 완납실적으로 간다
 * 완납실적   청구월이 있고 (일시납이거나 만료가 지났다). 환수도 여기 남는다
 * ```
 *
 * ★**청구월이 관문이다.** 인도되면 청구월이 박히고 그 순간 접수에서 나간다.
 *   인도일이 없으면 청구월을 비운다 — 원본 탭이 무슨 달이었든 **접수로 되돌린다**.
 *   이미 박힌 청구월은 안 고친다(사장님 「청구는 변동없는거고」).
 *
 * ★**환수는 취소가 아니다.** 계약은 완료됐고 나중에 조건이 터진 것 → 완납실적 + 마이너스 청구.
 * ★**한 줄은 한 탭에만 있다.** 위에서부터 걸러 내려간다 — 겹치면 대수가 두 번 세어진다.
 * ★분납 만료 = 인도일 + **회차개월**. 보증금 분납이라 회차 수가 곧 개월 수다.
 * ★청구서는 완전 별도다 — `scripts/build-settlement-billing.mts`.
 *
 * ★흩어진 탭을 **이름으로 열을 맞춰** 합친 뒤 다시 가른다. 자리로 찾지 않는다.
 *
 *   npx tsx scripts/build-settlement-tabs.mts
 *   npx tsx scripts/build-settlement-tabs.mts --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';

/** 데이터가 있을 만한 탭 전부. 있는 것만 읽어서 합친다. */
const SOURCES = ['실적', '작업', '접수', '취소', '분납실적', '완납실적', '당월실적'];
/**
 * ★**「기존실적」은 안 합친다.** 옛 도구가 만든 1,664줄이라 지금 규격과 안 맞고
 *   접수일이 비어 분납 만료가 엉뚱하게 잡힌다(사장님 「기존도구가 잘못됐을 수 있어」).
 *   지우지도 않는다 — 숨겨서 보관만 한다.
 */
const ARCHIVE = '기존실적';
const ARCHIVE_AS = '_옛실적 보관';
const CUR = '접수', CANCEL = '취소', PAY = '분납실적', DONE = '완납실적';
const KEEP = [CUR, CANCEL, PAY, DONE];
const BLANK = 60; // 접수 탭 아래 빈 줄 — 이어 적는 자리

/**
 * ★**접수 탭 맨 앞에만 붙는 칸**(사장님 2026-08-25 「접수에 당월 접수 당월완료건은
 *   실적 파악해야하니까 보여주자」). 다른 탭에는 없다 — 읽을 때는 머리글에서 빼고 본다.
 *   그래야 탭을 다시 합칠 때 이 칸이 다른 탭으로 번지지 않는다.
 */
const MARK = '구분';
const MARK_OPEN = '인도 전';   // 아직 안 끝난 것. 청구가 못 나간다
const MARK_DONE = '인도 완료'; // 인도까지 된 것. **이달이 마무리돼야 다른 탭으로 넘어간다**

/**
 * ★**계약은 두 단계다 — 계약서, 그다음 인도.**
 *   사장님 2026-08-25 「인도완료가 됐다는거는 계약서랑 이런거 다 썼다는거고 ·
 *   계약서 / 인도여부 이렇게 따지면 될거 같은데」.
 *   실측이 이 말을 받쳐 준다 — 옛 상태 「계약 완료 × 인도 전」 6건이 정확히
 *   «계약서는 됐는데 차가 안 나간» 줄이었다(191하5913·191호3293·190하8226·163조9326·109호4622·316라1593).
 *
 * ★**인도완료면 계약서는 당연히 참이다.** 거꾸로는 아니다 — 계약서만 되고 차가 안 나갈 수 있다.
 * ★인도완료는 «청구의 관문»이다. 체크하면 인도일이 박히고 청구월이 정해진다.
 *   계약서는 관문이 아니라 **어디까지 갔는지 보는 칸**이다.
 */
const PAPER_BOX = '계약서';
const DONE_BOX = '인도완료';
/**
 * ★**계약취소도 체크로 받는다**(사장님 2026-08-25 「계약취소 인도일 뒤에 만들어주세요
 *   체크할수 있게 계약취소하면 붉은색으로 바뀌게 해주고」).
 *   계약서·인도완료와 같은 줄기다 — 계약이 어디까지 갔는지를 체크 셋으로 읽는다.
 *   체크하면 그 줄이 **붉어지고**, 기계가 「취소」 탭으로 옮긴다.
 * ⚠ 그래서 상태 드롭다운에서 「계약 불가(취소)」는 뺐다 — 같은 말을 두 곳에 두면 어긋난다.
 */
const CANCEL_BOX = '계약취소';
/**
 * ★**환수도 체크다**(사장님 2026-08-25 「환수도 체크박스로 하는게 맞을거 같은데」).
 *   ★**체크하는 자리는 여기 한 곳뿐이다.** 환수는 «계약에 생긴 일»이라 실적 탭이 제자리고,
 *     청구 탭은 그 결과(순액)를 **읽기만** 한다. 두 곳에서 체크하게 두면 반드시 어긋난다.
 *   ★환수일을 적으면 환수월은 기계가 낸다. 청구 장부는 그 달에 마이너스를 잡는다.
 */
const CLAW_BOX = '환수';
const CLAW_DAY = '환수일';
const CLAW_AMT = '환수금액';
/**
 * ★**분납이 부러진 것**(사장님 2026-08-25 「분납 부러진거 확인할수 있게 해줘야 할거 같은데」).
 *   보증금 분납은 회차마다 돈이 들어와야 하는데 중간에 끊기는 일이 있다. 그게 «부러짐»이다.
 *   ⚠ **우리에게 회차별 입금 자료가 없다.** 그래서 기계가 알아낼 수 없고 사람이 체크한다 —
 *     기계는 «다음 회차가 언제인지»만 내 준다. 그 날이 지났는데 소식이 없으면 그때 확인한다.
 *   ★**부러졌으면 「환수」를 체크한다**(사장님 2026-08-25 「아니야 환수 체크하고」).
 *     체크 칸을 따로 두지 않는다 — 부러진 결과가 곧 돈을 되돌리는 일이고, 체크가 둘이면 어긋난다.
 *     환수를 켜면 그 줄은 분납실적에서 빠져 완납실적으로 간다.
 *   ★기계가 내 주는 것은 **「다음회차일」 하나**다 — «언제 확인해야 하나»를 알려 줄 뿐,
 *     들어왔는지는 회차별 입금 자료가 없어 알 수 없다.
 */
const NEXT_DAY = '다음회차일';
const CLAW_WHY = '환수사유';
/**
 * ★**환수사유 목록**(사장님 2026-08-25 「환수사유를 적자 · 환수사유에 드랍다운으로」).
 *   왜 돌려받았는지가 남아야 «같은 일이 또 나는지»를 본다. 목록에 없으면 그냥 적어도 된다(strict:false).
 */
const CLAW_WHYS = ['분납 미납', '대여료 미납', '중도해지', '계약위반', '사고', '고객요청', '기타'];

/**
 * ★**시트에서 걷어낼 옛 열.** 머리글은 탭에서 읽어 오므로, 안 쓰기로 한 열도 계속 따라온다.
 *   2026-08-25 「분납부러짐」 셋은 환수 체크 하나로 갈음했다(사장님 「아니야 환수 체크하고」).
 */
const RETIRED = ['분납부러짐', '부러진회차', '부러진날'];
/** 체크박스 칸 넷. 드롭다운을 걸면 안 된다. */
const BOXES = [PAPER_BOX, DONE_BOX, CANCEL_BOX, CLAW_BOX];

/**
 * ★**접수 탭은 팀장 작업대다** — 팀장이 적는 칸을 앞으로 모은다.
 *   원장 규격 그대로면 40열이라, 매일 쓰는 사람이 오른쪽 끝까지 훑어야 한다.
 *   여기 적힌 차례대로 앞에 서고, 나머지 원장 칸은 그 뒤에 원래 차례로 따라온다.
 * ★**「인도완료」는 체크박스다**(사장님 2026-08-25 「인도완료날짜를 쓰기보다는 체크로 하고
 *   보조적으로 날짜를 쓰는게 어떨까」). 체크하면 기계가 인도일을 박는다.
 */
/**
 * ★**「구분」 칸은 없앴다**(사장님 2026-08-25 「인도완료가 있는데 구분에 인도전 인도완료가 무슨 필요야??」).
 *   인도완료 체크와 같은 말이었다. 같은 말을 두 칸에 두면 언젠가 어긋난다.
 * ★**접수일이 맨 앞에 선다**(사장님 「접수일자가 없잖아」 「접수일자가 맨 앞이면 좋을거 같음」).
 *   계약금이 들어온 날이고, 실적을 세는 축이며, 줄을 세우는 차례다.
 */
/**
 * ★**월 칸이 날짜 바로 옆에 선다**(사장님 2026-08-25 「실적이랑 청구에는 월별로 관리를 해야하니까
 *   그걸 볼수 있게 해줘야하거든」). 접수월은 접수일 뒤, 청구월은 인도일 뒤다 —
 *   그 날짜가 그 달을 정하기 때문이다. 뒤쪽 기계 칸에 두면 거르려고 오른쪽 끝까지 가야 한다.
 * ★두 칸은 **기계가 낸다.** 사람이 고칠 자리가 아니라 잠근다.
 */
/**
 * ★**연과 월은 칸을 나눈다**(사장님 2026-08-25 「연 월을 칸으로 관리해야함 · 필터 잡을 수 있게」).
 *   「2026-08」 한 칸이면 필터에 스물몇 가지가 늘어서서 «2026년만» 이나 «8월만»을 못 고른다.
 *   나누면 연도 하나, 월 하나로 걸린다. 숫자로 넣어야 정렬도 1·2·…·12 로 선다.
 * ⚠ 도구들이 쓰는 열쇠는 여전히 「2026-08」이다 — 두 칸을 이어 붙여 만든다(`ymKey`).
 */
const CUR_FRONT: string[] = ['접수일', '접수년', '접수월', '차량번호', '공급사', '고객명', '고객연락처', '영업채널', '영업담당자',
  '상품구분', '계약기간', '보증금', '렌탈료', '차량가액', '분납여부', PAPER_BOX, DONE_BOX, '인도일', '청구년', '청구월',
  CANCEL_BOX, NEXT_DAY, CLAW_BOX, CLAW_WHY, CLAW_DAY, CLAW_AMT, '상태'];
/** 팀장이 손대는 칸 — 이 밖은 기계 칸이라 잠근다. */
// ★공급사는 «청구할 상대»라 앞에 선다. 기계가 채우는 칸이다.
const MACHINE_FRONT = ['접수년', '접수월', '청구년', '청구월', '공급사', NEXT_DAY];
const STAFF: string[] = CUR_FRONT.filter((h) => !MACHINE_FRONT.includes(h));
/**
 * ★**탭마다 열리는 칸이 다르다.** 양식(색·정렬·체크박스·메모)은 넷이 같지만,
 *   «적는 자리»는 그 탭이 하는 일에 따라 다르다 — 열어 둔 칸이 곧 «여기서 하는 일»이다.
 * ```
 * 접수      팀장 칸 스무 개 — 계약이 들어오고 나가는 곳
 * 분납실적   환수 셋만 — 분납 도는 동안 환수가 터지는 곳
 * 완납실적   환수 셋만 — 끝난 뒤에도 환수가 터질 수 있다
 * 취소      없음 — 보는 표다. 되살리려면 접수에서 계약취소를 끈다
 * ```
 */
const CLAW_TRIO: string[] = [CLAW_BOX, CLAW_WHY, CLAW_DAY, CLAW_AMT];

const OPEN: Record<string, string[]> = {};

/**
 * ★**상품구분이 수수료 기준을 정한다.** 그래서 팀장이 고르는 유일한 분류다.
 *   선출고·견적출고는 «차량가액» 기준이고 나머지는 «대여료 × 기간»이다(수수료표).
 * ★**렌트구분은 기계가 짝지어 채운다** — 실측 2026-08-25 둘이 거의 1:1이다
 *   (재렌트×장기렌트 182 · 구독×오플구독 115 · 신차렌트×선출고 84 · 구독×구독 32 · 신차렌트×견적출고 11).
 */
const PRODUCTS = ['장기렌트', '선출고', '견적출고', '구독', '오플구독'];
const RENT_KIND: Record<string, string> = { 장기렌트: '재렌트', 선출고: '신차렌트', 견적출고: '신차렌트', 구독: '구독', 오플구독: '구독' };
/** 분납 표기 — 원장 실측 그대로(2026-08-25 일시납 202 · 2회분납 212 · 3회분납 12). 회차가 곧 개월 수다. */
const PAY_KINDS = ['일시납', '2회분납', '3회분납'];

/**
 * ★**머리글 메모** — 그 칸에 무엇을 적는지 한 줄로. 마우스를 올리면 뜬다.
 *   매뉴얼을 따로 찾아보게 하지 않는다. 적는 자리에 적는 법이 붙어 있어야 한다.
 */
const HINT: Record<string, string> = {
  공급사: '차를 대는 회사이자 **청구할 상대**입니다. 기계가 채웁니다 — 월 + 공급사로 걸면 그게 그 달 그 회사에 끊을 계산서입니다.',
  접수년: '기계가 냅니다 — 접수일의 연도. 연도만 걸러 볼 때 씁니다.',
  접수월: '기계가 냅니다 — 접수일의 달(1~12). **이 달이 그 달 실적입니다.**',
  청구년: '기계가 냅니다 — 인도일의 연도.',
  청구월: '기계가 냅니다 — 인도일의 달(1~12). **이 달에 청구가 나갑니다.** 접수월과 다를 수 있습니다.',
  접수일: '계약금이 들어온 날. 비워 두면 기계가 오늘로 채웁니다. 한 번 박히면 안 바뀝니다 — 실적을 세는 축이라 흔들리면 돈이 흔들립니다.',
  차량번호: '재고 시트에 있는 번호 그대로. 같은 차가 다시 나갈 수 있어 «차량번호 + 접수일»이 한 계약입니다.',
  고객명: '계약서에 적히는 이름.',
  고객연락처: '휴대전화.',
  영업채널: '어느 채널에서 온 건인지. 목록이 없으니 그냥 적습니다 — 표기가 흔들리면 집계가 갈립니다.',
  영업담당자: '우리 쪽 담당자.',
  상품구분: '★수수료 기준을 정하는 칸입니다. 선출고·견적출고는 «차량가액» 기준, 나머지는 «대여료 × 기간» 기준입니다. 여기가 틀리면 청구액이 틀립니다.',
  계약기간: '개월 수만 숫자로. 48개월이면 48.',
  보증금: '숫자만. 쉼표는 기계가 붙입니다.',
  렌탈료: '월 대여료. 숫자만.',
  다음회차일: '기계가 냅니다 — 인도일 + n개월 중 오늘 이후 첫 날. 다 지났으면 비어 있습니다(만료). **이 날이 지났는데 소식이 없으면 확인하세요.**',
  환수사유: '왜 돌려받았나 — 분납 미납 · 대여료 미납 · 중도해지 · 계약위반 · 사고 · 고객요청 · 기타. 목록에 없으면 그냥 적어도 됩니다.',
  환수: '계약이 끝난 뒤 조건이 터져 돈을 되돌릴 때 체크 — **분납이 부러진 것도 여기에 체크합니다.** 켜면 그 줄은 분납실적에서 빠져 완납실적으로 갑니다. 환수는 여기서만 체크하고 청구 탭은 읽기만 합니다.',
  환수일: '환수가 잡힌 날. 이 날이 정하는 달에 청구 장부가 마이너스를 잡습니다. 비어 있으면 그 달 합계에 안 들어갑니다.',
  환수금액: '되돌릴 금액. 숫자만. ★**분납이 부러지면 «못 받은 회차분»을 적습니다** — '
    + '2회분납에서 1회차만 받고 끊겼으면 절반(50%), 3회분납에서 2회차까지 받았으면 1/3입니다. '
    + '처음에는 청구액 전액이 들어가 있으니 실제와 다르면 고치세요.',
  차량가액: '★신차(선출고·견적출고)는 **이 값이 수수료 기준**입니다 — 차량가액 × 요율. 장기렌트·구독은 안 적어도 됩니다(대여료 × 기간으로 냅니다). 숫자만.',
  분납여부: '보증금을 몇 번에 나눠 받나. 회차 수가 곧 개월 수라 분납 만료일(인도일 + 회차개월)이 여기서 나옵니다.',
  계약서: '계약서·서류가 다 되면 체크. 차가 아직 안 나가도 켤 수 있습니다.',
  인도완료: '★차가 나가면 체크. 그날이 인도일이 되고 청구월이 박힙니다 — 청구의 관문입니다. 켜면 계약서도 저절로 켜집니다.',
  인도일: '**선택입니다.** 체크한 날과 실제 인도일이 다를 때만 적습니다. 적으면 그 값이 이깁니다.',
  계약취소: '계약금이 들어왔다가 취소되면 체크. 체크하면 줄이 붉어지고 기계가 「취소」 탭으로 옮깁니다.',
  상태: '예정대로 «안 간 일»만 적습니다 — 환수 · 연장. 취소는 옆의 「계약취소」 체크로 합니다. 비어 있으면 계약중입니다.',
};
/**
 * ★**상태는 «예정대로 안 간 일»만 적는다. 셋뿐이다.**
 *   (사장님 2026-08-25 「계약완료 기준???? 이거 기준이 필요할까?」 — 필요 없다.)
 *
 * ★**「계약 완료」·「계약중」은 뺐다.** 답할 질문이 남아 있지 않다 —
 * ```
 * 차가 나갔나     → 인도완료 체크 / 인도일
 * 청구가 나갔나   → 청구월
 * 분납이 끝났나   → 분납만료 (인도일 + 회차개월)
 * 예정대로 안 갔나 → 상태  ← 여기만 남는다
 * ```
 *   실측 2026-08-25 — 「계약중」 8건은 전부 인도 전, 「계약 완료」 369건 중 363건이 인도됨.
 *   즉 사람이 상태 칸으로 «차가 나갔나»를 표시해 왔는데, 이제 인도완료 체크가 그 일을 한다.
 *   두 칸이 같은 말을 하면 언젠가 어긋나고, 어긋나면 어느 쪽이 맞는지 아무도 모른다.
 *
 * ★**비어 있으면 계약중이다.** 아무 일도 없다는 뜻이다.
 * ⚠ 옛 줄에 적힌 「계약 완료」 369건은 **그대로 둔다** — 과거는 이미 청구가 끝났고,
 *   지우면 원본과 대조할 근거가 사라진다. 목록에서만 뺀다(`strict:false` 라 남아 있어도 된다).
 */
/** ★환수·취소가 체크로 옮겨간 뒤 상태에 남는 말은 이것뿐이다. 그 밖은 그냥 적으면 된다(strict:false). */
const STATES = ['연장'];

/**
 * ★**탭 머리에 붙는 설명 한 줄**(사장님 2026-08-25 「각 탭 헤드에 설명을좀 해주면 될거 같어」).
 *   1행이 설명, **2행이 머리글**이다. 그래서 읽을 때는 «「차량번호」가 있는 줄»을 머리글로 찾는다 —
 *   1행을 머리글로 박아 두면 설명 줄을 넣는 순간 모든 도구가 통째로 어긋난다.
 */
const ABOUT: Record<string, string> = {};

/** ★말을 하나로. 원본의 「정산월」이 곧 사장님이 말하는 「청구월」이다. */
const RENAME: Record<string, string> = { 정산월: '청구월' };

Object.assign(ABOUT, {
  [CUR]: '접수 — 미처리 이월건 + 당월 접수건. 접수일 빠른 것이 위이고, 아래 빈 줄에 이어 적습니다. '
    + '① 계약금이 들어오면 «연노랑 칸»에 적습니다. 회색 칸은 기계가 채우니 비워 두세요(잠겨 있습니다). '
    + '② 계약서를 다 쓰면 「계약서」에 체크합니다. ③ 차가 나가면 「인도완료」에 체크합니다 — 그날이 인도일이 되고 청구월이 박힙니다. '
    + '날짜가 다르면 「인도일」 칸만 고치세요, 적힌 값이 이깁니다. ④ 취소되면 「계약취소」, 나중에 돈을 되돌리면 「환수」에 체크합니다. '
    + '**당월 건은 인도돼도 이달이 마무리될 때까지 여기 남습니다**(초록 줄 = 이번 달 실적). '
    + '달이 바뀌면 분납이면 「분납실적」, 일시납이면 「완납실적」으로 옮겨집니다.',
  [CANCEL]: '취소 — 계약금이 들어왔다가 취소된 것. 접수에 두면 일하는 표가 흐려져서 따로 뺐습니다. 되살아나면 접수로 다시 옮깁니다.',
  [PAY]: '분납실적 — 인도됐고 보증금 분납이 아직 안 끝난 것. **1회차는 인도 때 냈고**, 「다음회차일」이 다음에 들어올 날입니다 — '
    + '그 날이 지났는데 소식이 없으면 **「환수」에 체크하고 환수일·환수금액을 적으세요.** 분납이 부러진 것도 환수로 적습니다. '
    + '켜면 줄이 주황이 되고 청구에서 그만큼 빠지며, 더 굴러갈 회차가 없어 「완납실적」으로 옮겨집니다. 만료 = 인도일 + 회차개월. '
    + '만료가 지나고 환수가 없으면 제대로 이행된 것이라 저절로 완납실적으로 넘어갑니다. 만료 가까운 순으로 놓입니다.',
  [DONE]: '완납실적 — 끝난 것. 일시납이면 인도완료를 체크하는 순간 바로 여기로 오고, 분납은 만료가 지나면 옵니다. '
    + '환수도 여기 남습니다. 청구서는 «분납실적 + 완납실적»에서 만듭니다. 쌓기만 하고 손대지 않습니다.',
});

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
/**
 * ★**체크박스는 대소문자가 흔들린다.** 우리는 `'TRUE'` 로 쓰지만 구글은 불리언으로 저장하고,
 *   다시 읽으면 `true` 로 온다(실측 2026-08-25). 대문자로만 견주면 **다음 실행에서 체크가 통째로 무시된다** —
 *   취소한 줄이 취소 탭으로 안 옮겨지고 접수에 붉은 채로 남았다.
 */
const ON = (v: unknown) => /^(TRUE|참|Y|예|1)$/i.test(S(v));
const BOOL = (on: boolean) => (on ? 'TRUE' : 'FALSE');
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const today = new Date();
today.setHours(0, 0, 0, 0);
/**
 * ★**구글 날짜는 숫자로 온다.** `UNFORMATTED_VALUE` 로 읽으면 2026-08-25 가 `46259` 다.
 *   1899-12-30 을 0일로 센다. 20000~80000 사이면 serial 로 본다(1954~2119년).
 *   이걸 안 하면 `new Date('45301')` 이 **45301년**이 돼서 분납이 영원히 안 끝난다.
 */
const SERIAL0 = Date.UTC(1899, 11, 30);
const d = (v: string) => {
  const t = S(v);
  if (!t) return null;
  const n = Number(t);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const u = new Date(SERIAL0 + Math.round(n) * 86_400_000);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  const x = new Date(t);
  return Number.isNaN(+x) ? null : x;
};
const addM = (x: Date, n: number) => new Date(x.getFullYear(), x.getMonth() + n, x.getDate());
const p2 = (n: number) => String(n).padStart(2, '0');
const fmt = (x: Date) => `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`;
const ym = (x: Date) => `${x.getFullYear()}-${p2(x.getMonth() + 1)}`;
const MONTH = arg('month', ym(today));
const TODAY = fmt(today);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(30_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 180)}`);
  }
};

// ── 흩어진 탭을 합친다 ─────────────────────────────────────────────
const meta = await api(`${SH}/${LEDGER}?fields=sheets.properties(sheetId,title)`);
const titles: string[] = (meta.sheets || []).map((s: any) => S(s.properties.title));
const live = SOURCES.filter((t) => titles.includes(t));
if (!live.length) { console.log('⛔ 읽을 탭이 하나도 없다.'); process.exit(1); }

const canon = (h: string) => RENAME[S(h)] ?? S(h);
let head: string[] = [];
const seen = new Map<string, string[]>(); // 차량번호|접수일 → 줄
/** 접수 탭의 「인도완료」 체크 — 원장 머리글에는 없는 칸이라 따로 담는다. */
const takenDone = new Map<string, boolean>();
for (const tab of live) {
  const got = await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const all = ((got?.values || []) as unknown[][]).map((r) => (r || []).map(S));
  // ★머리글은 1행이 아니라 «「차량번호」가 있는 줄»이다. 위에 설명 줄이 붙어 있기 때문이다.
  const hi = all.findIndex((r) => r.includes('차량번호'));
  const rows = hi < 0 ? all : all.slice(hi);
  if (rows.length < 2) { console.log(`   ${tab.padEnd(8)} — 비었다`); continue; }
  const h = rows[0].map(canon);
  // ★접수 탭에만 붙는 칸(구분·인도완료)은 원장 머리글에 넣지 않는다 — 넣으면 네 탭 전부로 번진다.
  if (!head.length) head = h.filter((x) => x !== MARK && x !== DONE_BOX && !RETIRED.includes(x));
  // ★자리가 아니라 이름으로 옮겨 담는다. 탭마다 열 순서가 다를 수 있다.
  const pick = head.map((name) => h.indexOf(name));
  const kPlate = head.indexOf('차량번호'), kRecv = head.indexOf('접수일');
  const iBox = h.indexOf(DONE_BOX);           // 접수 탭에만 있다
  let add = 0;
  for (const r of rows.slice(1)) {
    const row = pick.map((i) => (i >= 0 ? S(r[i]) : ''));
    if (!row[kPlate]) continue;
    const key = `${row[kPlate]}|${row[kRecv]}`;
    if (seen.has(key)) continue;
    seen.set(key, row);
    if (iBox >= 0 && ON(r[iBox])) takenDone.set(key, true);
    add++;
  }
  console.log(`   ${tab.padEnd(8)} ${String(rows.length - 1).padStart(4)}줄 읽음 → 새것 ${add}`);
}
const at = (n: string) => head.indexOf(n);
const [iPlate, iState, iDeliver, iPay, iBillM, iRecv] = ['차량번호', '상태', '인도일', '분납여부', '청구월', '접수일'].map(at);
if (iPlate < 0 || iDeliver < 0 || iBillM < 0) { console.log('⛔ 「차량번호」·「인도일」·「청구월」 중에 없는 열이 있다.'); process.exit(1); }

/**
 * ── 「계약서」 칸을 세운다 ──────────────────────────────────────────
 * ★원장에 없던 칸이라 여기서 만든다. 한 번 만들면 다음부터는 시트에서 읽힌다.
 * ★**옛 줄의 초기값은 짐작이 아니라 근거로 넣는다** —
 *   인도됐으면 계약서는 당연히 된 것이고, 옛 상태가 「계약 완료」·「계약서 업로드」면 계약서가 된 것이다.
 *   그 밖은 «모른다»가 아니라 «아직 아니다»로 본다 — 계약금만 들어온 단계다.
 */
{
  // ★새 칸은 머리글에 «먼저» 세운다 — 없으면 뒤에서 `at()` 이 -1 을 돌려주고 판정이 통째로 어긋난다.
  for (const c of [PAPER_BOX, CANCEL_BOX, CLAW_BOX, CLAW_WHY, CLAW_DAY, CLAW_AMT, NEXT_DAY, '접수년', '청구년']) if (!head.includes(c)) head.push(c);
  const iPaper = head.indexOf(PAPER_BOX), iCan = head.indexOf(CANCEL_BOX);
  const iClaw = head.indexOf(CLAW_BOX), iAmt = head.indexOf(CLAW_AMT), iSt = at('상태');
  let made = 0, canned = 0, clawed = 0;
  for (const row of seen.values()) {
    const st = iSt >= 0 ? S(row[iSt]) : '';
    // ★값이 있으면 그 뜻을 지키되 **표기는 늘 TRUE/FALSE 로 못 박는다**(true/false 로 돌아오기 때문).
    if (!S(row[iPaper])) { row[iPaper] = BOOL(!!d(row[iDeliver]) || /계약\s*완료|계약서/.test(st)); made++; }
    else row[iPaper] = BOOL(ON(row[iPaper]));
    if (!S(row[iCan])) { row[iCan] = BOOL(/취소|계약\s*불가/.test(st)); canned++; }
    else row[iCan] = BOOL(ON(row[iCan]));
    /**
     * ★환수 초기값 — 옛 상태가 「환수」면 켜고, **되돌릴 돈은 청구액(판매수수료)부터** 적어 둔다.
     *   실제 금액이 다르면 사람이 고친다. 환수일은 원장에 없으니 비워 둔다 — 사람이 채운다.
     */
    if (!S(row[iClaw])) {
      const on = /환수/.test(st);
      row[iClaw] = BOOL(on);
      if (on && iAmt >= 0 && !S(row[iAmt])) row[iAmt] = S(row[at('판매수수료')]);
      clawed++;
    } else row[iClaw] = BOOL(ON(row[iClaw]));

  }
  /**
   * ★**상태에서 「계약 완료」·「계약서 업로드」를 비운다.** 그 뜻은 이제 「계약서」 체크가 담는다 —
   *   두 칸이 같은 말을 하면 언젠가 어긋난다. 상태는 **«예정대로 안 간 일»만** 남는다.
   *   ⚠ 잃는 것은 없다. 체크로 옮겨 담았고, 「원본탭」 열이 남아 있어 원본과 대조도 된다.
   *   ⚠ 「환수」·「계약 불가(취소)」는 그대로 둔다 — 그건 사건이다.
   */
  let cleared2 = 0;
  if (iSt >= 0) for (const row of seen.values()) {
    // 「계약 완료」는 계약서 체크로, 「계약 불가(취소)」는 계약취소 체크로 옮겨 담았다.
    // 「계약 완료」→계약서 · 「계약 불가(취소)」→계약취소 · 「환수」→환수 체크로 옮겨 담았다.
    // ★「계약중」도 비운다 — **비어 있으면 계약중**이 규칙이라 글자로 또 적으면 두 말이 된다.
    if (/^계약\s*완료$|^계약서\s*업로드$|^계약\s*불가.*$|^환수$|^계약\s*중$|^계약\s*진행\s*중$/.test(S(row[iSt]))) { row[iSt] = ''; cleared2++; }
  }
  if (made) console.log(`   계약서 — ${made}줄에 초기값을 넣었다(인도됐거나 옛 상태가 「계약 완료」면 참)`);
  if (canned) console.log(`   계약취소 — ${canned}줄에 초기값을 넣었다(옛 상태가 「계약 불가(취소)」면 참)`);
  if (clawed) console.log(`   환수    — ${clawed}줄에 초기값을 넣었다(옛 상태가 「환수」면 참 · 환수금액은 청구액부터)`);
  if (cleared2) console.log(`   상태  — 옛 「계약 완료」·「계약 불가(취소)」 ${cleared2}줄을 비웠다. 그 뜻은 계약서·계약취소 체크가 담는다`);
}

/**
 * ── 팀장이 적은 줄을 기계가 이어받는다 ──────────────────────────────
 * ★**접수일은 «그 차번을 처음 본 날»이고 한 번 박히면 안 바뀐다**(사장님 2026-08-24).
 *   정산월·수수료가 접수일에서 나오므로 이 날짜가 흔들리면 돈이 흔들린다.
 *   ⚠ 「처음 본 날」은 이 도구가 도는 주기만큼만 정확하다 — 하루 한 번은 돌아야 «쓴 날»과 같아진다.
 * ★**인도완료에 체크하면 그날이 인도일이다.** 실제 인도일이 다르면 팀장이 인도일 칸을 고친다 —
 *   적힌 값이 이긴다. 체크를 풀어도 인도일은 안 지운다(청구가 이미 나갔을 수 있다).
 */
{
  const iDone = takenDone;                    // 접수 탭에서 읽어 둔 「인도완료」 체크
  const iSrc = at('원본탭');
  let stamped = 0, delivered = 0;
  for (const [key, row] of seen) {
    /**
     * ⚠ **원본에서 온 줄에는 오늘을 안 박는다.** 「원본탭」이 적혀 있으면 몇 달 전 계약이다 —
     *   접수일이 비었다고 오늘을 적으면 반년 묵은 건이 오늘 들어온 것처럼 보인다(실측 2026-08-25 2줄).
     *   그런 줄은 «모른다»로 비워 두고 사람이 채운다.
     */
    if (!S(row[iRecv]) && !(iSrc >= 0 && S(row[iSrc]))) { row[iRecv] = TODAY; stamped++; }
    if (iDone && iDone.get(key) && !S(row[iDeliver])) { row[iDeliver] = TODAY; delivered++; }
    // ★인도됐으면 계약서는 당연히 참이다(사장님). 거꾸로는 아니다.
    const ip = head.indexOf(PAPER_BOX);
    if (ip >= 0 && d(row[iDeliver])) row[ip] = 'TRUE';
  }
  if (stamped || delivered) console.log(`   이어받음 — 접수일 ${stamped}칸 · 체크로 인도일 ${delivered}칸 (오늘 ${TODAY})`);
}

// ── 말과 값을 먼저 다듬는다 ─────────────────────────────────────────
/**
 * ★「계약진행중」은 옛말이다 — 공급사 시트가 쓰는 **「계약중」**에 맞춘다(2026-08-25 실측 8줄).
 * ★날짜 칸에 serial 범위 밖 숫자(`-467874` 같은)가 있으면 **버린다.** 고칠 근거가 없다.
 * ★렌트구분이 비어 있으면 상품구분에서 짝지어 채운다.
 */
let reworded = 0, dropped = 0, kinded = 0;
{
  const iState2 = at('상태'), iProd = at('상품구분'), iKind = at('렌트구분');
  for (const row of seen.values()) {
    if (iState2 >= 0 && /계약\s*진행\s*중/.test(S(row[iState2]))) { row[iState2] = '계약중'; reworded++; }
    if (iKind >= 0 && iProd >= 0 && !S(row[iKind]) && RENT_KIND[S(row[iProd])]) { row[iKind] = RENT_KIND[S(row[iProd])]; kinded++; }
    for (const c of ['접수일', '인도일']) {
      const i = at(c);
      if (i < 0) continue;
      const v = S(row[i]);
      const num = Number(v);
      if (v && Number.isFinite(num) && (num < 20000 || num > 80000)) { row[i] = ''; dropped++; }
    }
  }
}

// ── 날짜 칸은 숫자가 아니라 글자로 박는다 ─────────────────────────────
// ★시트에 숫자로 남아 있으면 다음에 읽는 도구가 또 45301년을 만난다.
const iDateCols = ['접수일', '인도일'].map(at).filter((i) => i >= 0);
let redated = 0;
for (const row of seen.values()) {
  for (const i of iDateCols) {
    const x = d(row[i]);
    if (x && S(row[i]) !== fmt(x)) { row[i] = fmt(x); redated++; }
  }
}

// ── 청구월을 인도일이 정한다 ────────────────────────────────────────
/**
 * ★**청구월도 글자로 박는다.** 시트에 날짜값으로 들어 있으면 `46296` 으로 읽혀서
 *   `'46296' > '2026-08'` 같은 글자 비교가 전부 참이 된다 — 달 가르기가 통째로 망가진다.
 */
let filled = 0, cleared = 0, remonth = 0;
const iBillY = at('청구년');
for (const row of seen.values()) {
  /**
   * 옛 「청구월」이 「2026-08」 한 칸이던 것을 연/월 두 칸으로 가른다.
   * ⚠ **나뉜 뒤의 월 칸(「8」)을 날짜 해석기에 넣으면 안 된다** —
   *   `new Date('8')` 은 **2001-08-01** 로 읽힌다(실측 2026-08-25, 청구년이 통째로 2001이 됐다).
   *   그래서 «연 칸이 이미 있으면 그것부터» 보고, 없을 때만 옛 표기를 푼다.
   */
  const cur0 = S(row[iBillM]);
  /**
   * ⚠ **말이 안 되는 연도는 버린다.** 2026-08-25 에 나뉜 월 칸(「8」)을 날짜 해석기에 넣어
   *   청구년이 통째로 2001이 된 적이 있다. 굳은 값은 다시 계산해도 그대로 나오므로 여기서 걷어낸다.
   */
  const y0 = Number(S(row[iBillY]));
  const curY = Number.isFinite(y0) && y0 >= 2020 && y0 <= 2100 ? String(y0) : '';
  const norm = curY && cur0 ? `${curY}-${String(Number(cur0)).padStart(2, '0')}`
    : /^\d{4}-\d{2}$/.test(cur0) ? cur0
    : (() => { const x = /^\d{4}-\d{2}-\d{2}$/.test(cur0) || Number(cur0) > 20000 ? d(cur0) : null; return x ? ym(x) : ''; })();
  const del = d(row[iDeliver]);
  let key = norm;
  if (!del) { if (key) { key = ''; cleared++; } }        // 인도 전이면 청구가 없다
  else if (!key) { key = ym(del); filled++; }            // 이미 박힌 건 안 고친다
  const y = key ? key.slice(0, 4) : '';
  const m = key ? String(Number(key.slice(5, 7))) : '';
  if (iBillY >= 0 && S(row[iBillY]) !== y) { row[iBillY] = y; remonth++; }
  row[iBillM] = m;
}

/**
 * ★**다음 회차일** — 인도일 + n개월 중 «오늘 이후 첫 날». 다 지났으면 비운다(만료된 것이다).
 *   보증금 분납이라 회차 수가 곧 개월 수다. 이 날이 지났는데 돈이 안 들어오면 부러진 것이다.
 */
const nextRound = (r: string[]) => {
  const m = /(\d)\s*회/.exec(S(r[iPay]));
  const del = d(r[iDeliver]);
  if (!m || !del || Number(m[1]) < 2) return '';
  /**
   * ★**1회차는 인도 때 낸다**(사장님 2026-08-25 「보증금 분납은 인도받으면서 보증금 1회차를 내지」).
   *   그래서 k회차 예정일은 **인도일 + (k−1)개월**이고, 2회차부터가 «앞으로 들어올 돈»이다.
   */
  for (let k = 2; k <= Number(m[1]); k++) { const x = addM(del, k - 1); if (x >= today) return fmt(x); }
  return '';
};

/**
 * 분납 만료 — **인도일 + 회차개월**. 일시납·인도 전은 없다.
 * ★마지막 납입은 인도일 + (회차−1)개월이고, 여기에 **한 달 여유**를 더해 완료를 판정한다.
 *   사장님 말씀 두 개가 그렇게 만나 앉는다 —
 *   「1회차를 인도받으면서 내지」(납입 시점)와 「인도일로부터 3개월이 지나면 3회차 분납은 완료」(완료 판정).
 */
const dueOf = (r: string[]) => {
  const m = /(\d)\s*회/.exec(S(r[iPay]));
  const del = d(r[iDeliver]);
  if (!m || !del || Number(m[1]) < 2) return null;
  return addM(del, Number(m[1]));
};

const cur: string[][] = [], cancel: string[][] = [], pay: string[][] = [], done: string[][] = [];
/**
 * ★**«행선지»와 «시점»은 다른 이야기다**(2026-08-25 내가 이걸 섞어 한 번 틀렸다).
 * ```
 * 행선지 — 인도완료되면 분납이면 「분납실적」, 일시납이면 「완납실적」으로 간다
 * 시점  — 다만 **당월 접수건은 이달이 마무리될 때까지 접수에 머문다**
 *         (사장님 「완납실적으로 넘기는거는 이달 마무리 되면」 · 「접수에 당월거는 아직 안옮긴다고」)
 * ```
 *   그래서 접수 탭에는 «아직 못 한 일 + 이번 달에 한 일»이 같이 보인다 — 그게 이번 달 실적이다.
 *   달이 바뀌면 그 줄들이 행선지로 옮겨간다.
 */
const curDone: string[][] = [];
/** ★열쇠는 여전히 「2026-08」이다 — 나뉜 두 칸을 이어 붙여 만든다. */
const ymKey = (y: string, m: string) => (S(y) && S(m) ? `${S(y)}-${String(Number(m)).padStart(2, '0')}` : '');
const recvMonth = (r: string[]) => { const x = d(r[iRecv]); return x ? ym(x) : ymKey(S(r[at('접수년')]), S(r[at('접수월')])); };
const billKey = (r: string[]) => ymKey(S(r[at('청구년')]), S(r[at('청구월')]));
for (const row of seen.values()) {
  const st = S(row[iState]);
  // ★위에서부터 걸러 내려간다. 취소는 «체크»가 정하고, 청구월이 없으면 아직 접수다.
  if (ON(row[head.indexOf(CANCEL_BOX)])) cancel.push(row);
  else if (!billKey(row)) cur.push(row);
  else if (recvMonth(row) === MONTH) curDone.push(row); // 이달 마무리 전이라 아직 접수에 있다
  else {
    const due = dueOf(row);
    // ★환수를 켜면 분납은 끝난다 — 완납실적으로 보낸다. 되돌릴 돈은 환수금액이 말한다.
    if (due && due >= today && !ON(row[head.indexOf(CLAW_BOX)])) pay.push(row);
    else done.push(row);
  }
}
/**
 * ★**접수월도 «글자»로 박는다.** 청구월과 똑같은 함정이다 —
 *   `USER_ENTERED` 로 「2026-06」을 쓰면 구글이 날짜로 바꿔 `46174` 로 되돌아온다(실측 2026-08-25).
 *   접수일에서 다시 내고, 쓸 때 RAW 로 덮는다.
 */
{
  const iRecvY = at('접수년'), iRecvM = at('접수월');
  for (const row of seen.values()) {
    const x = d(row[iRecv]);
    if (iRecvY >= 0) row[iRecvY] = x ? String(x.getFullYear()) : '';
    if (iRecvM >= 0) row[iRecvM] = x ? String(x.getMonth() + 1) : '';
  }
}

// ★다음 회차일을 박아 둔다 — 사람이 «언제 확인해야 하나»를 여기서 본다.
{
  const iNext = head.indexOf(NEXT_DAY);
  if (iNext >= 0) for (const row of seen.values()) row[iNext] = nextRound(row);
}
const bySort = (i: number) => (a: string[], b: string[]) => S(a[i]).localeCompare(S(b[i]));
cur.sort(bySort(iRecv)); // 오래 묵은 접수가 위 — 인도가 안 될수록 위험하다
curDone.sort(bySort(iDeliver));
cancel.sort(bySort(iRecv));
pay.sort((a, b) => +(dueOf(a) || 0) - +(dueOf(b) || 0)); // 만료 가까운 순
done.sort(bySort(iBillM));

/**
 * 접수 탭 머리글 — 팀장 칸이 앞에 서고 원장 칸이 뒤따른다.
 * ★`구분`·`인도완료`는 원장에 없는 칸이라 여기서 만든다.
 */
const CUR_HEAD: string[] = [...CUR_FRONT, ...head.filter((h) => !CUR_FRONT.includes(h))];
/** 원장 한 줄 → 접수 탭 한 줄. 이름으로 옮긴다. */
const toCur = (r: string[]) => CUR_HEAD.map((h) => {
  if (h === DONE_BOX) return BOOL(!!d(r[iDeliver]));   // 체크박스
  if (BOXES.includes(h)) { const i = head.indexOf(h); return BOOL(ON(r[i])); }
  const i = head.indexOf(h);
  return i >= 0 ? S(r[i]) : '';
});
/**
 * ★**접수일 빠른 것이 위**(사장님 2026-08-25 「순서는 접수일빠른게 위로 올라가야지 아래로 죽죽 쓸수 있게끔」).
 *   인도됐든 아니든 한 줄기로 세운다 — 아래 빈 줄에 그냥 이어 적으면 된다.
 *   접수일이 없는 줄은 맨 위에 온다. 「모른다」가 눈에 걸려야 채워진다.
 */
const curBody = [...cur, ...curDone]
  .sort((a, b) => S(a[iRecv]).localeCompare(S(b[iRecv])))
  .map((r) => toCur(r));
const total = cur.length + curDone.length + cancel.length + pay.length + done.length;
console.log(`\n■ 정산원장 탭 넷으로 — 오늘 ${fmt(today)} ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`   ${CUR.padEnd(6)} ${String(cur.length).padStart(4)}줄   ${MARK_OPEN} — 청구월이 없다 (+ 빈 줄 ${BLANK})`);
if (curDone.length) console.log(`   ${''.padEnd(6)} ${String(curDone.length).padStart(4)}줄   ↳ ${MONTH} 접수해서 인도까지 된 것 — 이달 마무리되면 행선지로 간다`);
console.log(`   ${CANCEL.padEnd(6)} ${String(cancel.length).padStart(4)}줄   계약 불가(취소)`);
console.log(`   ${PAY.padEnd(6)} ${String(pay.length).padStart(4)}줄   청구됨 + 분납 만료 전`);
console.log(`   ${DONE.padEnd(6)} ${String(done.length).padStart(4)}줄   청구됨 + 일시납·만료됨·환수`);
console.log(`   ${'합계'.padEnd(6)} ${String(total).padStart(4)}줄   (합친 원천 ${seen.size}줄과 같아야 한다)`);
console.log(`\n   청구월 — 인도일로 새로 박은 것 ${filled} · 인도 전이라 지운 것 ${cleared}`);
console.log(`   다듬음 — 「계약진행중」→「계약중」 ${reworded} · 말이 안 되는 날짜 ${dropped}칸 비움 · 렌트구분 ${kinded}칸 채움`);

if (cur.length) {
  console.log(`\n  ── ${CUR} — 오래 묵은 순 (인도가 안 되면 청구가 영영 안 나간다)`);
  for (const r of cur.slice(0, 12)) console.log(`     ${S(r[iPlate]).padEnd(11)} 접수 ${S(r[iRecv]).padEnd(11)} ${S(r[at('공급사')]).slice(0, 9).padEnd(10)} ${S(r[at('고객명')]).padEnd(7)} ${S(r[at('영업담당자')])}`);
  if (cur.length > 12) console.log(`     … 외 ${cur.length - 12}줄`);
}
if (pay.length) {
  console.log(`\n  ── ${PAY} — 만료 가까운 순`);
  for (const r of pay.slice(0, 10)) {
    const due = dueOf(r)!;
    console.log(`     ${S(r[iPlate]).padEnd(11)} ${S(r[iPay]).padEnd(7)} 인도 ${S(r[iDeliver]).padEnd(11)} → 만료 ${fmt(due)} (${Math.round((+due - +today) / 86_400_000)}일)  ${S(r[at('공급사')]).slice(0, 8)}`);
  }
  if (pay.length > 10) console.log(`     … 외 ${pay.length - 10}줄`);
}

writeFileSync('tmp/settlement-tabs.json', JSON.stringify({ cur: cur.length, cancel: cancel.length, pay: pay.length, done: done.length, filled, cleared }, null, 2));
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다.\n'); process.exit(0); }

// ── 쓴다 ─────────────────────────────────────────────────────────
const FONT = 'Noto Sans KR';
/**
 * ★**조건부 서식은 걸기 전에 지운다.** `addConditionalFormatRule` 은 쌓이기만 한다 —
 *   실측 2026-08-25 접수 탭에 규칙이 **19개** 쌓여 있었고, 그중 열일곱이 이미 없어진
 *   「구분」 칸(A열)을 보는 죽은 규칙이었다. 죽은 규칙은 조용히 틀린 색을 칠한다.
 */
const wipeRules = async (gid: number) => {
  const got = await api(`${SH}/${LEDGER}?fields=sheets(properties(sheetId),conditionalFormats)`);
  const cnt = ((got.sheets || []) as any[]).find((x) => Number(x.properties?.sheetId) === gid)?.conditionalFormats?.length || 0;
  if (!cnt) return 0;
  // 뒤에서부터 지운다 — 앞에서 지우면 index 가 밀린다.
  const reqs = Array.from({ length: cnt }, (_, i) => ({ deleteConditionalFormatRule: { sheetId: gid, index: cnt - 1 - i } }));
  await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
  return cnt;
};

const gidOf = (t: string) => (meta.sheets || []).find((s: any) => S(s.properties.title) === t)?.properties?.sheetId;
/**
 * ★**네 탭이 같은 차례로 선다**(사장님 2026-08-25 「접수탭이 그대로 넘어가고 분납실적 / 완납실적에
 *   접수탭 뒤로 세부조건들을 쭉 달아야 하는거잖아」).
 *   한 계약이 접수 → 분납실적 → 완납실적으로 옮겨가는데 탭마다 열 차례가 다르면
 *   같은 줄을 볼 때마다 눈이 다시 자리를 찾아야 한다. 앞은 접수 차례, 뒤는 세부 조건이다.
 * ⚠ 접수 탭만 뒤 칸을 접는다 — 매일 적는 표라 좁아야 한다. 나머지는 다 펴 둔다(보는 표다).
 */
for (const [tab, rowsIn, extra] of [[CUR, curBody, BLANK], [CANCEL, cancel.map((r) => toCur(r)), 10], [PAY, pay.map((r) => toCur(r)), 10], [DONE, done.map((r) => toCur(r)), 10]] as const) {
  const body = rowsIn as string[][];
  const hd = CUR_HEAD;
  const iBillHere = hd.indexOf('청구월');
  let gid = gidOf(tab);
  if (gid === undefined) {
    const made = await api(`${SH}/${LEDGER}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab, gridProperties: { rowCount: body.length + extra + 12, columnCount: hd.length, frozenRowCount: 2 } } } }] }),
    });
    gid = made.replies[0].addSheet.properties.sheetId;
  }
  await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}:clear`, { method: 'POST', body: '{}' });
  // ★합친 칸을 먼저 푼다. 안 그러면 다음 번 머리글이 합쳐진 채로 덮인다.
  await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ unmergeCells: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1 } } }] }) });
  const about = ABOUT[tab] || '';
  await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1`)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    // ★A1 은 탭 이름, B1 부터가 설명이다. 고정 열(A)과 합칠 수 없어서 갈라 놓는다.
    body: JSON.stringify({ values: [[tab, about], hd, ...body] }),
  });
  /**
   * ★**청구월만 RAW 로 다시 쓴다.** `USER_ENTERED` 는 `"2026-08"` 을 **날짜로 파싱**해서
   *   2026-08-01 로 만들어 버린다. 그러면 다음에 읽을 때 `46235` 라는 숫자가 나오고
   *   `'46235' > '2026-08'` 같은 글자 비교가 전부 참이 돼 달 가르기가 통째로 망가진다.
   *   `RAW` 는 준 그대로 글자로 넣는다. 금액은 USER_ENTERED 로 이미 숫자가 됐다.
   */
  // ★연·월은 이제 숫자 칸이라 날짜로 바뀔 일이 없다. RAW 로 덮던 손질을 뺀다.
  if (false && iBillHere >= 0 && body.length) {
    const cl = colA1(iBillHere); // 옛 길 — 위 반복문이 대신한다
    // ★1행이 설명, 2행이 머리글이라 값은 3행부터다.
    await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!${cl}3:${cl}${body.length + 2}`)}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: body.map((r) => [S(r[iBillHere])]) }),
    });
  }
  const wiped = await wipeRules(Number(gid));
  if (wiped) console.log(`   ${tab} — 옛 조건부 서식 ${wiped}개 지움`);
  await api(`${SH}/${LEDGER}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        { repeatCell: { range: { sheetId: Number(gid) }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10 } } }, fields: 'userEnteredFormat.textFormat(fontFamily,fontSize)' } },
        // 1행 — 설명. 칸을 합쳐 한 문장으로 읽히게 한다.
        { mergeCells: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: hd.length }, mergeType: 'MERGE_ROWS' } },
        { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 11, bold: true } } }, fields: 'userEnteredFormat.textFormat' } },
        { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10, foregroundColor: { red: 0.25, green: 0.29, blue: 0.35 } }, backgroundColor: { red: 0.97, green: 0.98, blue: 1 }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,verticalAlignment,wrapStrategy)' } },
        // ★설명 줄은 글이 다 보이게 연다(사장님 2026-08-25 「위에 업무 설명하는 헤더 좀 더 크게 열어주고」).
        { updateDimensionProperties: { range: { sheetId: Number(gid), dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 62 }, fields: 'pixelSize' } },
        // 2행 — 머리글
        { repeatCell: { range: { sheetId: Number(gid), startRowIndex: 1, endRowIndex: 2 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10, bold: true }, backgroundColor: { red: 0.93, green: 0.95, blue: 0.99 }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)' } },
        { updateSheetProperties: { properties: { sheetId: Number(gid), gridProperties: { frozenRowCount: 2, frozenColumnCount: 1 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
        { setBasicFilter: { filter: { range: { sheetId: Number(gid), startRowIndex: 1, startColumnIndex: 0, endColumnIndex: hd.length } } } },
        /**
         * ★줄 색 — **취소가 초록보다 먼저다.** 구글은 «먼저 걸린 규칙»이 이기므로
         *   붉은색을 index 0 에 둬야 취소된 줄이 초록으로 안 덮인다.
         */
        ...(tab === CUR && hd.indexOf(CANCEL_BOX) >= 0 ? [{ addConditionalFormatRule: { rule: {
          ranges: [{ sheetId: Number(gid), startRowIndex: 2, endRowIndex: Math.max(body.length + 2, 3), startColumnIndex: 0, endColumnIndex: hd.length }],
          booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=$${colA1(hd.indexOf(CANCEL_BOX))}3=TRUE` }] }, format: { backgroundColor: { red: 0.99, green: 0.87, blue: 0.87 }, textFormat: { foregroundColor: { red: 0.6, green: 0.1, blue: 0.1 } } } },
        }, index: 0 } }] : []),
        // ★인도된 줄은 옅은 초록 — 「구분」 글자를 없앤 자리를 색이 대신한다.
        ...(hd.indexOf(CLAW_BOX) >= 0 ? [{ addConditionalFormatRule: { rule: {
          ranges: [{ sheetId: Number(gid), startRowIndex: 2, endRowIndex: Math.max(body.length + 2, 3), startColumnIndex: 0, endColumnIndex: hd.length }],
          booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=$${colA1(hd.indexOf(CLAW_BOX))}3=TRUE` }] }, format: { backgroundColor: { red: 1, green: 0.94, blue: 0.82 } } },
        }, index: 1 } }] : []),
        ...(tab === CUR && hd.indexOf(DONE_BOX) >= 0 ? [{ addConditionalFormatRule: { rule: {
          ranges: [{ sheetId: Number(gid), startRowIndex: 2, endRowIndex: Math.max(body.length + 2, 3), startColumnIndex: 0, endColumnIndex: hd.length }],
          booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=$${colA1(hd.indexOf(DONE_BOX))}3=TRUE` }] }, format: { backgroundColor: { red: 0.92, green: 0.97, blue: 0.92 } } },
        }, index: 2 } }] : []),
      ],
    }),
  });
  console.log(`   ✓ ${tab} ${body.length}줄`);
}

/**
 * ★**탭 색깔**(사장님 2026-08-25 「탭색깔 넣어주고」).
 *   일하는 탭이 파랑, 지켜볼 탭이 주황, 끝난 탭이 초록, 돈 탭이 남색, 접힌 것이 회색.
 */
const TAB_COLOR: Record<string, { red: number; green: number; blue: number }> = {
  [CUR]: { red: 0.16, green: 0.44, blue: 0.84 },     // 파랑 — 매일 여는 곳
  [CANCEL]: { red: 0.62, green: 0.62, blue: 0.62 },  // 회색 — 끝나 버린 것
  [PAY]: { red: 0.95, green: 0.62, blue: 0.11 },     // 주황 — 지켜볼 것
  [DONE]: { red: 0.2, green: 0.66, blue: 0.33 },     // 초록 — 끝난 것
};
{
  const meta2 = await api(`${SH}/${LEDGER}?fields=sheets.properties(sheetId,title)`);
  const reqs = ((meta2.sheets || []) as any[]).map((x) => x.properties)
    .filter((p: any) => TAB_COLOR[S(p.title)])
    .map((p: any) => ({ updateSheetProperties: { properties: { sheetId: p.sheetId, tabColor: TAB_COLOR[S(p.title)] }, fields: 'tabColor' } }));
  if (reqs.length) { await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) }); console.log(`   ✓ 탭 색깔 ${reqs.length}개`); }
}

/**
 * ── 접수 탭을 «팀장 작업대»로 꾸민다 ────────────────────────────────
 * ★**팀장 칸은 연노랑, 기계 칸은 회색.** 색이 곧 «여기만 적으세요»다.
 * ★**기계 칸은 잠근다.** 구글시트는 탭마다 권한을 못 나누니 «범위»로 나눈다 —
 *   원장을 편집 권한으로 열어 줘도 팀장이 완납실적·청구를 건드릴 수 없다.
 * ★**드롭다운은 셋뿐이다** — 상품구분·분납여부·상태. 나머지는 그냥 쓴다
 *   (사장님 2026-08-25 「영업채널 드롭다운 없어 그냥 쓸꺼야」).
 * ★상품구분이 수수료 기준을 정하므로 **여기가 틀리면 돈이 틀린다.**
 */
Object.assign(OPEN, {
  // ★「다음회차일」은 기계가 내는 칸이라 어디서도 안 연다.
  [CUR]: STAFF.filter((h) => !CLAW_TRIO.includes(h)),
  [PAY]: CLAW_TRIO,   // 분납이 부러지면 여기서 환수를 켠다
  [DONE]: CLAW_TRIO,
  [CANCEL]: [],
});
const gidMap = ((await api(`${SH}/${LEDGER}?fields=sheets.properties(sheetId,title)`)).sheets || [])
  .map((x: any) => x.properties) as { sheetId: number; title: string }[];
for (const [DTAB, DBODY] of [[CUR, curBody], [CANCEL, cancel], [PAY, pay], [DONE, done]] as const) {
  const gid = Number(gidMap.find((x) => S(x.title) === DTAB)?.sheetId);
  if (!Number.isFinite(gid)) continue;
  const OPEN_HERE = OPEN[DTAB] || [];
  const col = (n: string) => CUR_HEAD.indexOf(n);
  const rowsN = (DBODY as unknown[]).length + (DTAB === CUR ? BLANK : 4);
  const lastRow = 2 + rowsN;                     // 1행 설명 · 2행 머리글 · 3행부터 값
  const YEL = { red: 1, green: 0.98, blue: 0.88 };
  const GREY = { red: 0.96, green: 0.96, blue: 0.97 };
  const cell = (c: number, bg: any) => ({ repeatCell: {
    range: { sheetId: gid, startRowIndex: 2, endRowIndex: lastRow, startColumnIndex: c, endColumnIndex: c + 1 },
    cell: { userEnteredFormat: { backgroundColor: bg } }, fields: 'userEnteredFormat.backgroundColor',
  } });
  /** 드롭다운을 걷어낸다 — `rule` 없이 보내면 그 범위의 유효성 검사가 지워진다. */
  const clearList = (c: number) => ({ setDataValidation: {
    range: { sheetId: gid, startRowIndex: 2, endRowIndex: lastRow, startColumnIndex: c, endColumnIndex: c + 1 },
  } });
  const list = (c: number, vals: string[]) => ({ setDataValidation: {
    range: { sheetId: gid, startRowIndex: 2, endRowIndex: lastRow, startColumnIndex: c, endColumnIndex: c + 1 },
    // strict:false — 목록에 없는 값도 적을 수 있다. 새 상품·새 상태가 생겨도 안 막힌다.
    rule: { condition: { type: 'ONE_OF_LIST', values: vals.map((v) => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false },
  } });
  const money = (c: number) => ({ repeatCell: {
    range: { sheetId: gid, startRowIndex: 2, endRowIndex: lastRow, startColumnIndex: c, endColumnIndex: c + 1 },
    cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0;;""' }, horizontalAlignment: 'RIGHT' } },
    fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
  } });
  /**
   * ★정렬은 판매시트 규격을 따른다 — **금액만 오른쪽, 나머지는 가운데**
   *   (사장님 2026-08-25 「접수일 이런거는 가운데 정렬하는게 맞아 보이고」).
   *   가운데로 두면 날짜·번호가 줄마다 같은 자리에 서서 세로로 훑힌다.
   */
  const MONEY_COLS = ['보증금', '렌탈료', '차량가액', CLAW_AMT];
  /**
   * ★**날짜는 `yy-mm-dd`**(사장님 2026-08-25 「yy mm dd로 해주면돼」).
   *   26-08-25 처럼 짧게 — 40열이 넘는 표에서 네 자리 연도는 자리만 먹는다.
   *   연·월 칸(접수년·접수월…)은 따로다. 그건 필터로 거를 숫자다.
   */
  const DATE_COLS = ['접수일', '인도일', CLAW_DAY, NEXT_DAY, '분납만료'];
  const dateFmt = (c: number) => ({ repeatCell: {
    range: { sheetId: gid, startRowIndex: 2, endRowIndex: lastRow, startColumnIndex: c, endColumnIndex: c + 1 },
    cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yy-mm-dd' }, horizontalAlignment: 'CENTER' } },
    fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
  } });
  const center = (c: number) => ({ repeatCell: {
    range: { sheetId: gid, startRowIndex: 2, endRowIndex: lastRow, startColumnIndex: c, endColumnIndex: c + 1 },
    cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat.horizontalAlignment',
  } });

  const reqs: any[] = [];
  // 칸 색 — **적는 칸은 연노랑 · 잠긴 칸은 회색.** 네 탭이 같은 규칙이라 눈이 안 헷갈린다.
  for (let c = 0; c < CUR_HEAD.length; c++) reqs.push(cell(c, OPEN_HERE.includes(CUR_HEAD[c]) ? YEL : GREY));
  /**
   * ★**드롭다운은 「상태」와 「상품구분」 둘뿐이다**(사장님 2026-08-25
   *   「드롭다운 다 없애 · 그냥 그때그때 입력하게끔 · 드롭다운은 상태값이나 상품분류 같은거만」).
   *   ★둘만 남기는 이유는 **정해진 말이 있어야 하는 칸**이라서다 —
   *     상품구분은 수수료 기준을 정하고(선출고=차량가액), 상태는 줄이 어느 탭으로 갈지를 정한다.
   *     고객명·연락처·영업채널처럼 «매번 다른 값»은 목록이 될 수 없다.
   *   ★**분납여부도 넣는다**(사장님 2026-08-25 「분납여부 2회 3회 있어 · 드랍다운 해줘」).
   *     이 값이 **분납 만료일(인도일 + 회차개월)**을 정한다 — 표기가 흔들리면 감시에서 빠진다.
   *     목록은 원장 실측 그대로다: 일시납 202 · 2회분납 212 · 3회분납 12(2026-08-25).
   *   ⚠ `strict:false` 라 목록에 없는 값도 적힌다. 막지 않고 고르기 쉽게만 해 둔다.
   *   체크박스(인도완료)는 드롭다운이 아니라 그대로 둔다.
   */
  // 드롭다운은 «적는 탭»에만 건다. 보는 탭에 걸면 못 고치는데 목록만 뜬다.
  const DROPS: Record<string, string[]> = DTAB === CUR
    ? { 상품구분: PRODUCTS, 분납여부: PAY_KINDS, 상태: STATES }
    : OPEN_HERE.includes(CLAW_WHY) ? { [CLAW_WHY]: CLAW_WHYS } : {};   // 잠긴 탭엔 안 건다 — 목록만 뜨고 못 고친다
  for (let c = 0; c < CUR_HEAD.length; c++) {
    const h = CUR_HEAD[c];
    if (BOXES.includes(h)) continue;
    reqs.push(DROPS[h] ? list(c, DROPS[h]) : clearList(c));
  }
  // 계약서 · 인도완료 — 체크박스 둘
  for (const b of BOXES) if (col(b) >= 0) reqs.push({ setDataValidation: {
    range: { sheetId: gid, startRowIndex: 2, endRowIndex: lastRow, startColumnIndex: col(b), endColumnIndex: col(b) + 1 },
    rule: { condition: { type: 'BOOLEAN' }, showCustomUi: true },
  } });
  // 머리글 메모 — 그 칸에 무엇을 적는지
  for (let c = 0; c < CUR_HEAD.length; c++) {
    const t = HINT[CUR_HEAD[c]];
    if (!t) continue;
    reqs.push({ repeatCell: {
      range: { sheetId: gid, startRowIndex: 1, endRowIndex: 2, startColumnIndex: c, endColumnIndex: c + 1 },
      cell: { note: t }, fields: 'note',
    } });
  }
  // 정렬 — 금액은 오른쪽, 그 밖은 가운데
  for (let c = 0; c < CUR_HEAD.length; c++) if (!MONEY_COLS.includes(CUR_HEAD[c])) reqs.push(center(c));
  for (const nm of MONEY_COLS) if (col(nm) >= 0) reqs.push(money(col(nm)));
  for (const nm of DATE_COLS) if (col(nm) >= 0) reqs.push(dateFmt(col(nm)));
  // 열 폭 — 팀장 칸은 넉넉히, 기계 칸은 좁게
  for (let c = 0; c < CUR_HEAD.length; c++) {
    const w = CUR_HEAD[c] === '고객연락처' ? 110 : BOXES.includes(CUR_HEAD[c]) ? 68
      : STAFF.includes(CUR_HEAD[c]) ? 92 : 76;
    reqs.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, properties: { pixelSize: w }, fields: 'pixelSize' } });
  }
  /**
   * 팀장 칸 다음부터 접어 둔다 — 매일 볼 것이 아니다.
   * ⚠ **펴는 명령을 반드시 같이 보낸다.** 접는 것만 보내면 «옛 실행에서 접힌 칸»이 그대로 남는다 —
   *   실측 2026-08-25: 칸이 늘어 「계약취소」·「상태」가 앞자리로 왔는데도 접힌 채였다
   *   (사장님 「취소 박스 어딨어?」). 자리가 바뀌는 표에서는 접기와 펴기가 한 쌍이어야 한다.
   */
  const firstMachine = CUR_FRONT.length;
  // ★접수만 뒤 칸을 접는다 — 매일 적는 표라 좁아야 한다. 나머지는 다 펴 둔다(보는 표다).
  reqs.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 0, endIndex: firstMachine }, properties: { hiddenByUser: false }, fields: 'hiddenByUser' } });
  reqs.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: firstMachine, endIndex: CUR_HEAD.length }, properties: { hiddenByUser: DTAB === CUR }, fields: 'hiddenByUser' } });
  /**
   * ★**환수 셋은 접수 탭에서 접는다**(사장님 2026-08-25 「환수는 계약완료되서 나오는거니까
   *   접수탭에는 있을필요는 없어 · 분납실적 완납실적에만 존재하지」).
   *   접수는 «차가 나가기 전»을 다루는 표라 되돌릴 돈이 아직 없다.
   */
  if (DTAB === CUR) for (const c of [...CLAW_TRIO, NEXT_DAY]) {
    const i = col(c);
    if (i >= 0) reqs.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } });
  }
  await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });

  /**
   * ★**잠금.** 시트 전체를 잠그고 팀장 칸만 뚫는다 —
   *   구글은 «보호 범위 안의 예외 범위»를 지원하므로 한 번에 끝난다.
   *   ⚠ 먼저 옛 잠금을 지운다. 안 그러면 돌릴 때마다 겹쳐 쌓인다.
   */
  const cur0 = await api(`${SH}/${LEDGER}?fields=sheets(protectedRanges(protectedRangeId,range(sheetId)))`);
  const old = ((cur0.sheets || []) as any[]).flatMap((x) => x.protectedRanges || [])
    .filter((r: any) => Number(r.range?.sheetId) === gid).map((r: any) => Number(r.protectedRangeId));
  const staffCols = CUR_HEAD.map((h, i) => (OPEN_HERE.includes(h) ? i : -1)).filter((i) => i >= 0);
  const runs: [number, number][] = [];
  for (const i of staffCols) { const last = runs[runs.length - 1]; if (last && last[1] === i) last[1] = i + 1; else runs.push([i, i + 1]); }
  await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
    ...old.map((id) => ({ deleteProtectedRange: { protectedRangeId: id } })),
    { addProtectedRange: { protectedRange: {
      range: { sheetId: gid },
      description: OPEN_HERE.length ? '기계가 채우는 칸 — 연노랑 칸만 적습니다' : '보는 표입니다 — 기계가 채웁니다',
      warningOnly: false,
      editors: { users: ['pyh@teamjpk.com'] },
      unprotectedRanges: runs.map(([a, b]) => ({ sheetId: gid, startRowIndex: 2, endRowIndex: lastRow, startColumnIndex: a, endColumnIndex: b })),
    } } },
  ] }) });
  console.log(`   ✓ ${DTAB.padEnd(6)} 적는 칸 ${String(OPEN_HERE.length).padStart(2)}${OPEN_HERE.length && OPEN_HERE.length <= 5 ? `(${OPEN_HERE.join('·')})` : ''} · 잠근 칸 ${CUR_HEAD.length - OPEN_HERE.length}${Object.keys(DROPS).length ? ` · 드롭다운 ${Object.keys(DROPS).join('·')}` : ''}`);
}

// ★다 만든 뒤에 지운다 — 먼저 지우면 실패했을 때 아무것도 안 남는다.
const after = await api(`${SH}/${LEDGER}?fields=sheets.properties(sheetId,title)`);
const props = (after.sheets || []).map((s: any) => s.properties);
const kill = props.filter((p: any) => SOURCES.includes(S(p.title)) && !KEEP.includes(S(p.title)));
if (kill.length) {
  await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: kill.map((p: any) => ({ deleteSheet: { sheetId: p.sheetId } })) }) });
  console.log(`   ✓ 지운 옛 탭 — ${kill.map((p: any) => S(p.title)).join(' · ')}`);
}
// ★옛 실적은 지우지 않는다. 이름만 바꿔 숨긴다 — 나중에 대조할 일이 있다.
const arch = props.find((p: any) => S(p.title) === ARCHIVE);
if (arch) {
  await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{
    updateSheetProperties: { properties: { sheetId: arch.sheetId, title: ARCHIVE_AS, hidden: true }, fields: 'title,hidden' },
  }] }) });
  console.log(`   ✓ 「${ARCHIVE}」 → 「${ARCHIVE_AS}」 숨김 보관`);
}

const LOG = 'docs/수정이력-정산원장.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const h0 = existsSync(LOG) ? readFileSync(LOG, 'utf8') : '# 수정이력 — 정산원장\n\n> 기계가 정산원장 구조를 바꿀 때마다 여기에 쌓는다. 새 것이 위.\n';
const entry = `\n## ${when} · 탭을 넷으로 — ${CUR} ${cur.length} · ${CANCEL} ${cancel.length} · ${PAY} ${pay.length} · ${DONE} ${done.length}\n\n도구 \`scripts/build-settlement-tabs.mts --apply\`\n**청구월이 관문이다.** 인도일이 없으면 청구월을 비우고 접수에 남긴다(${cleared}줄), 인도일이 있으면 박는다(${filled}줄).\n접수는 월로 안 자른다 — 계속 쌓이고 한 줄씩 옮겨간다. 취소는 따로 뺐다. 「정산월」은 **「청구월」**로 이름을 통일했다.\n`;
const marker = '> 기계가 정산원장 구조를';
const cut = h0.indexOf(marker);
const insertAt = cut >= 0 ? h0.indexOf('\n', cut) + 1 : h0.length;
writeFileSync(LOG, h0.slice(0, insertAt) + entry + h0.slice(insertAt));

console.log(`\n■ 끝 — 합계 ${total}줄`);
console.log(`   https://docs.google.com/spreadsheets/d/${LEDGER}/edit\n`);
