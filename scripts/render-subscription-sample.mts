/**
 * **구독 표준계약서 «샘플» 을 PDF 로 뽑는다** — 사장님 2026-09-17
 *   「PDF로 샘플 구독용 샘플 줘봐 보험 포함, 별도가 같이 되어있나?」
 *   「구독 샘플 반납/인수 같이 되어있나?」
 *
 * ★답을 «종이로» 보여 주려고 만든 것이다. 네 벌을 한 번에 뽑는다 —
 *     구독 반납형 × 보험포함 / 보험별도
 *     구독 인수형 × 보험포함 / 보험별도
 *
 * ★서식은 «한 벌» 이다(public/contract-template/rental-contract.html).
 *   인수/반납(state.pd)도, 보험 포함/별도(state.ins)도 «같은 서식 안에서» 갈린다.
 *   서식을 넷으로 만들지 않는다 — 그러면 조항 하나 고칠 때 네 군데를 고쳐야 한다.
 *
 * ★값은 «샘플» 이다. 기존 검토 스크립트(render-freepass-standard-contract-review.mts)의
 *   표본 값을 그대로 쓰고 갈래만 바꾼다 — 새 값을 지어내지 않는다.
 *
 *   npx tsx scripts/render-subscription-sample.mts
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { inlineContractPdfFonts } from '../lib/server/contract-pdf-assets';
import { buildFreepassContractHtml } from '../lib/server/freepass-contract-html';

const root = process.cwd();
const outputDir = path.join(root, 'output', 'pdf');

/** 표본 값 — 검토 스크립트와 «같은 홍길동» 이다. 실제 고객 값이 아니다. */
const baseFields: Record<string, string> = {
  contract_no: 'SAMPLE-구독-0001',
  customer_name: '홍길동',
  customer_phone: '010-1234-1234',
  customer_address: '서울특별시 강남구 테헤란로 000',
  vehicle_model: '제네시스 G80',
  vehicle_trim: '2.5 터보 AWD',
  vehicle_plate: '12가1234',
  vehicle_color: '화이트 / 블랙',
  vehicle_fuel: '가솔린',
  rent_monthly: '1,000,000',
  deposit_amount: '1,000,000',
  contract_months: '48',
  annual_mileage: '20,000',
  driver_age: '만 26세 이상',
  start_date: '2026년 10월 1일',
  end_date: '2030년 9월 30일',
};

/**
 * ★★사장님 2026-09-17 「계약서에는 다 넣어서 «선택으로» 보험료를 누가 부담하든
 *   구독계약서는 «하나» 여야 하는데」 — 맞는 말씀이고, 실제로 그렇게 돼 있다.
 *
 *   서식은 `public/contract-template/rental-contract.html` «한 파일» 이다.
 *   아래 네 갈래는 «다른 계약서» 가 아니라 그 한 벌이 state 를 받아 다르게 인쇄한 것이다.
 *   ⇒ 조항 하나를 고치면 여섯 갈래에 «같이» 먹는다. 그래서 하나로 두는 것이다.
 *   ★esign-templates.ts 에 3벌로 적힌 것은 «관리자가 고르는 목록» 이지 문서 수가 아니다.
 */
type 벌 = { 이름: string; pd: '구독인수형' | '구독선택형' | '렌트인수형' | '렌트선택형'; ins: '포함' | '별도'; 파일: string };

const 벌들: 벌[] = [
  { 이름: '구독 반납형 · 보험포함', pd: '구독선택형', ins: '포함', 파일: 'freepass-subscription-return-insurance-included-SAMPLE.pdf' },
  { 이름: '구독 반납형 · 보험별도', pd: '구독선택형', ins: '별도', 파일: 'freepass-subscription-return-insurance-separate-SAMPLE.pdf' },
  { 이름: '구독 인수형 · 보험포함', pd: '구독인수형', ins: '포함', 파일: 'freepass-subscription-buyout-insurance-included-SAMPLE.pdf' },
  { 이름: '구독 인수형 · 보험별도', pd: '구독인수형', ins: '별도', 파일: 'freepass-subscription-buyout-insurance-separate-SAMPLE.pdf' },
  /** ★렌트는 «회사포함» 하나뿐이다 — 회사가 소유주로서 영업용 보험을 든다
   *  (esign-contract-kind.ts: rent_* 의 insuranceSides 는 ['회사포함']). */
  { 이름: '렌트 반납형 · 보험포함', pd: '렌트선택형', ins: '포함', 파일: 'freepass-rent-return-SAMPLE.pdf' },
  { 이름: '렌트 인수형 · 보험포함', pd: '렌트인수형', ins: '포함', 파일: 'freepass-rent-buyout-SAMPLE.pdf' },
];

await mkdir(outputDir, { recursive: true });

const executablePath = process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : undefined;
const browser = await chromium.launch({ headless: true, executablePath });

try {
  for (const 벌 of 벌들) {
    const fields = { ...baseFields };
    /** ★보험 칸의 «말» 도 갈린다 — 별도인데 「포함」 이라 적히면 계약서가 거짓말을 한다 */
    fields.insurance_condition = 벌.ins === '별도'
      ? '개인보험형 (계약자가 본인 명의로 직접 가입)'
      : '보험료 포함 (월 구독료에 포함)';
    /** 인수형은 인수가격을 반드시 적는다(esign-contract-kind.ts buyoutPriceRequired) */
    fields.buyout_price = /인수형$/.test(벌.pd) ? '12,000,000' : '만기협의';

    const sealed = {
      state: { co: 'auto', pd: 벌.pd, ins: 벌.ins, ct: '개인', car: '등록완료', tax: '개인' },
      fields,
      signature: '',
      sealHash: 'SAMPLE-NOT-FOR-SIGNATURE',
    };

    let html = await inlineContractPdfFonts(
      await buildFreepassContractHtml(sealed, { includePrintButton: false, root }),
      root,
    );
    /** ★샘플임을 «종이 위에» 박는다. 파일 이름만으로는 인쇄하면 사라진다 */
    html = html.replace(/<body([^>]*)>/i, `<body$1><div class="fp-sample-banner">샘플 · ${벌.이름} · 서명 및 실계약 사용 금지</div>`);
    html = html.replace('</style>', `
      .fp-sample-banner{position:absolute;top:4mm;left:50%;transform:translateX(-50%);z-index:9999;
        padding:2mm 5mm;border:1px solid #b45309;background:#fff7ed;color:#9a3412;
        font:700 10px Pretendard,sans-serif;letter-spacing:.02em}
      @media print{.fp-sample-banner{position:absolute}}
    </style>`);

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    await page.evaluate(async () => { await document.fonts.ready; });
    const out = path.join(outputDir, 벌.파일);
    await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
    /** 갈래가 실제로 종이에 반영됐는지 «읽어서» 확인한다 — 파일이 나왔다고 맞는 게 아니다 */
    const 확인 = await page.evaluate(() => ({
      보험: document.querySelector('[data-field="insurance_condition"]')?.textContent?.replace(/\s+/g, ' ').trim() || '(없음)',
      보험포함블록: getComputedStyle(document.querySelector('[data-ins="포함"]') || document.body).display,
      보험별도블록: getComputedStyle(document.querySelector('[data-ins="별도"]') || document.body).display,
    }));
    await page.close();
    console.log(`${벌.이름}  →  ${벌.파일}`);
    console.log(`   보험칸: ${확인.보험}`);
  }
} finally {
  await browser.close();
}
console.log('\n뽑은 곳: output/pdf/');
