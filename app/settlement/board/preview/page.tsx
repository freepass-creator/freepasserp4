'use client';
/**
 * **정산 콕핏 — 미리보기 문.** 로그인 없이 «얼굴만» 본다.
 *
 * ★★★사장님 2026-09-09 「일단 화면 디자인부터 하고 로그인에 붙이면 안 될까?」
 *   디자인을 다듬는 동안 로그인이 길을 막으면 한 번 고칠 때마다 로그인을 해야 한다.
 *   ⇒ 같은 얼굴(`SettlementBoard`)에 «샘플»만 물린 문을 따로 둔다.
 *
 * ★★★⚠⚠ **진짜 값을 여기 싣지 않는다.** 로그인 없이 열리는 문이라
 *   고객 이름 하나, 금액 한 줄만 새도 그건 사고다.
 *   아래 값은 전부 **지어낸 것**이다 — 차번도 이름도 실제와 겹치지 않게 지었다.
 *   ⇒ 그래서 이 문은 서버를 «안 부른다». 부를 API 자체가 없다.
 *
 * ★디자인이 굳으면 이 문은 남겨 둔다 — 다음에 얼굴을 고칠 때 또 쓴다.
 *   대신 도면에 「샘플만 도는 문」이라고 적어 두어 진짜와 헷갈리지 않게 한다.
 */
import { useMemo } from 'react';
import SettlementBoard, { type BoardApi, type Board } from '@/components/settlement/SettlementBoard';
import IntakeStation from '@/components/settlement/IntakeStation';

/** ★지어낸 값 — 실제 거래처·고객과 겹치지 않는 이름만 쓴다. */
const SAMPLE: Board = {
  month: '2026-08',
  months: ['2026-10', '2026-09', '2026-08', '2026-07'],
  sum: { claim: 53674591, pay: 49553890, clawSup: 1265455, clawCh: 532364, net: 4725735, rows: 53 },
  suppliers: [
    { name: '가나렌트', n: 19, won: 19834545, issued: true },
    { name: '다라캐피탈', n: 6, won: 9457525, issued: true },
    { name: '마바모빌리티', n: 4, won: 6821300, issued: false },
    { name: '사아자동차', n: 4, won: 4459800, issued: false },
    { name: '차카렌터카', n: 4, won: 4301400, issued: false },
    { name: '타파렌트', n: 2, won: 2209091, issued: false },
  ],
  channels: [
    { name: '하나채널', n: 40, won: 41046290, issued: true },
    { name: '두리채널', n: 6, won: 6749655, issued: true },
    { name: '세미채널', n: 3, won: 3770250, issued: true },
  ],
  carry: [
    { id: 'x1', plate: '11가1111', customer: '김샘플', supplier: '차카렌터카', month: '2026-08', to: '2026-09', claim: 616200, pay: 474000, prepaid: 0, note: '2회 분할 청구 — 이번이 1회차. 남은 1회차는 다음 달에 같은 비율로' },
    { id: 'x2', plate: '22나2222', customer: '이보기', supplier: '마바모빌리티', month: '2026-08', to: '2026-09', claim: -810563, pay: -810563, prepaid: 0, note: '과청구 1.5% 환수 — 8.5% 로 나간 것을 7% 로 바로잡음' },
    { id: 'x3', plate: '33다3333', customer: '박예시', supplier: '차카렌터카', month: '2026-09', to: '2026-10', claim: 686400, pay: 533867, prepaid: 1161000, note: '선지급 받은 몫이 있어 9월 청구에서 뺀다' },
  ],
  /** 접수 내역 — 넣으면 여기 «맨 위»에 선다(미리보기라 새로고침하면 돌아간다). */
  rows: [
    { id: 'r1', code: 'stl_s1', plate: '11가1111', customer: '김샘플', supplier: '차카렌터카', channel: '하나채널', agent: '이보기', product: '선출고', billMonth: '2026-08', receivedAt: '2026-08-04', deliveredAt: '2026-08-12', claim: 616200, pay: 474000, stage: '청구', claimStage: '청구', payStage: '통보', invoiceIssued: false, invoiceAt: '', note: '2회분납 1회차', carryNote: '' },
    { id: 'r2', code: 'stl_s2', plate: '22나2222', customer: '이보기', supplier: '마바모빌리티', channel: '하나채널', agent: '최예제', product: '신차발주', billMonth: '2026-08', receivedAt: '2026-08-20', deliveredAt: '2026-08-26', claim: 3783000, pay: 3783000, stage: '정정', claimStage: '정정', payStage: '확인', invoiceIssued: true, invoiceAt: '2026-09-07', note: '', carryNote: '' },
    { id: 'r3', code: 'stl_s3', plate: '33다3333', customer: '박예시', supplier: '가나렌트', channel: '두리채널', agent: '김보기', product: '오플구독', billMonth: '2026-08', receivedAt: '2026-08-25', deliveredAt: '', claim: 800000, pay: 640000, stage: '접수', claimStage: '접수', payStage: '접수', note: '', carryNote: '', invoiceIssued: false, invoiceAt: '' },
  ],
  /** 접수 — 청구월이 «아직 안 박힌» 줄. 원장 「접수」 탭과 같다(달로 안 자른다). */
  intake: [
    { id: 'i1', code: 'stl_i1', plate: '44라4444', customer: '정대기', supplier: '가나렌트', channel: '세미채널', agent: '이샘플', product: '선발주', billMonth: '', receivedAt: '2026-09-02', deliveredAt: '', claim: 0, pay: 0, stage: '접수', claimStage: '접수', payStage: '접수', invoiceIssued: false, invoiceAt: '', note: '인도 대기', carryNote: '', paper: true, delivered: false, term: 48, model: '현대 그랜저 GN7' },
    { id: 'i2', code: 'stl_i2', plate: '55마5555', customer: '한예약', supplier: '타파렌트', channel: '하나채널', agent: '박샘플', product: '장기렌트', billMonth: '', receivedAt: '2026-09-05', deliveredAt: '', claim: 0, pay: 0, stage: '접수', claimStage: '접수', payStage: '접수', invoiceIssued: false, invoiceAt: '', note: '', carryNote: '', paper: false, delivered: false, term: 36, model: '벤츠 E-클래스 W214' },
    /** ★할 일 — 차는 나갔는데 청구월이 안 박혔다. 놓치면 그 줄은 어느 달에도 안 선다. */
    { id: 'i3', code: 'stl_i3', plate: '66바6666', customer: '조놓침', supplier: '사아자동차', channel: '두리채널', agent: '이예시', product: '구독', billMonth: '', receivedAt: '2026-08-28', deliveredAt: '2026-09-03', claim: 0, pay: 0, stage: '접수', claimStage: '접수', payStage: '접수', invoiceIssued: false, invoiceAt: '', note: '', carryNote: '', paper: true, delivered: true, term: 24, model: '기아 카니발 KA4' },
  ],
  found: [
    { id: 'y1', code: 'stl_sample1', plate: '11가1111', customer: '김샘플', supplier: '차카렌터카', channel: '하나채널', agent: '이보기', product: '선출고', billMonth: '2026-08', receivedAt: '2026-08-04', deliveredAt: '2026-08-12', claim: 616200, pay: 474000, stage: '청구', claimStage: '청구', payStage: '통보', invoiceIssued: false, invoiceAt: '', note: '2회분납 1회차', carryNote: '' },
    { id: 'y2', code: 'stl_sample2', plate: '22나2222', customer: '이보기', supplier: '마바모빌리티', channel: '하나채널', agent: '최예제', product: '신차발주', billMonth: '2026-08', receivedAt: '2026-08-20', deliveredAt: '2026-08-26', claim: 3783000, pay: 3783000, stage: '정정', claimStage: '정정', payStage: '확인', invoiceIssued: true, invoiceAt: '2026-09-07', note: '신차는 청구 = 지급 · 수익 0', carryNote: '다음 달에 계산서 수정' },
  ],
  /** 재고 — 화면이 즉시 좁힌다(지어낸 값). */
  cars: [
    { plate: '11가1111', name: '기아 니로', maker: '기아', trim: 'SG2 에어', supplier: '차카렌터카', product: '중고구독', year: '2023', status: '출고가능',
      fuel: '하이브리드', cls: '소형 SUV', km: 32000, seats: 5, color: '흰색', rent: 700000, deposit: 1400000, term: '36',
      terms: [{ term: '36', rent: 700000, deposit: 1400000 }, { term: '24', rent: 730000, deposit: 1460000 }, { term: '12', rent: 770000, deposit: 1540000 }] },
    { plate: '22나2222', name: '현대 아반떼', maker: '현대', trim: 'CN7 모던', supplier: '마바모빌리티', product: '중고렌트', year: '2024', status: '출고가능',
      fuel: '가솔린', cls: '준중형 세단', km: 18000, seats: 5, color: '검정', rent: 520000, deposit: 1000000, term: '48',
      terms: [{ term: '48', rent: 520000, deposit: 1000000 }, { term: '36', rent: 560000, deposit: 1100000 }] },
    { plate: '33다3333', name: '기아 쏘렌토', maker: '기아', trim: 'MQ4 시그니처', supplier: '가나렌트', product: '오플구독', year: '2022', status: '계약중',
      fuel: '디젤', cls: '중형 SUV', km: 54000, seats: 7, color: '회색', rent: 830000, deposit: 1660000, term: '48',
      terms: [{ term: '48', rent: 830000, deposit: 1660000 }] },
    { plate: '44라4444', name: '현대 그랜저', maker: '현대', trim: 'GN7 캘리그래피', supplier: '가나렌트', product: '신차렌트', year: '2025', status: '출고가능',
      fuel: '가솔린', cls: '준대형 세단', km: 3000, seats: 5, color: '남색', rent: 1120000, deposit: 2200000, term: '60',
      terms: [{ term: '60', rent: 1120000, deposit: 2200000 }, { term: '48', rent: 1180000, deposit: 2300000 }] },
    { plate: '55마5555', name: '벤츠 E-클래스', maker: '벤츠', trim: 'W214 E250', supplier: '타파렌트', product: '중고렌트', year: '2024', status: '출고가능',
      fuel: '가솔린', cls: '대형 세단', km: 12000, seats: 5, color: '은색', rent: 1650000, deposit: 3300000, term: '36',
      terms: [{ term: '36', rent: 1650000, deposit: 3300000 }] },
    { plate: '66바6666', name: '기아 카니발', maker: '기아', trim: 'KA4 노블레스', supplier: '사아자동차', product: '중고구독', year: '2023', status: '출고불가',
      fuel: 'LPG', cls: '대형 MPV', km: 41000, seats: 9, color: '흰색', rent: 980000, deposit: 1960000, term: '48',
      terms: [{ term: '48', rent: 980000, deposit: 1960000 }] },
  ],
  suggest: {
    suppliers: ['가나렌트', '다라캐피탈', '마바모빌리티', '사아자동차', '차카렌터카', '타파렌트'],
    channels: ['하나채널', '두리채널', '세미채널', '네오채널'],
    agents: ['이보기', '이샘플', '이예시', '김보기', '최예제', '박샘플'],
    products: ['선출고', '선발주', '신차발주', '장기렌트', '구독'],
    models: ['기아 니로 SG2 에어', '현대 아반떼 CN7', '벤츠 S-클래스 W222'],
    customers: ['김샘플', '이보기', '박예시', '최예제'],
    plates: ['11가1111', '22나2222', '33다3333', '44라4444'],
  },
};

export function useSampleApi(): BoardApi {
  const api = useMemo<BoardApi>(() => ({
    ready: true,
    load: async (month) => ({ ...SAMPLE, month: month || SAMPLE.month }),
    /**
     * ⚠ 미리보기는 **아무 데도 안 쓴다.** 다만 「넣으면 목록에 한 줄 선다」를 눈으로 봐야 하므로,
     *   화면 안에서만 그 줄을 만들어 보여 준다(새로고침하면 사라진다).
     */
    save: async (patch) => {
      const id = `preview_${Date.now()}`;
      SAMPLE.intake = [{
        id, code: id, plate: String(patch.plate || ''), customer: String(patch.customer || ''),
        supplier: String(patch.supplier || ''), channel: String(patch.channel || ''), agent: String(patch.agent || ''),
        product: String(patch.product || ''), billMonth: String(patch.billMonth || ''),
        receivedAt: String(patch.receivedAt || ''), deliveredAt: String(patch.deliveredAt || ''),
        claim: 0, pay: 0, stage: '접수', claimStage: '접수', payStage: '접수',
        invoiceIssued: false, invoiceAt: '', note: String(patch.note || ''), carryNote: '',
      }, ...SAMPLE.intake];
      return { ok: true, id };
    },
    /** 미리보기 — 화면 안에서만 켜진다(새로고침하면 돌아간다). */
    edit: async (id, patch) => {
      SAMPLE.intake = SAMPLE.intake.map((r) => (r.id === id ? { ...r, ...patch } : r));
      return { ok: true };
    },
    /**
     * 줄 하나를 통째로 — 미리보기라 «목록에 있는 만큼»을 그대로 되돌려준다.
     * ⚠ 진짜 원자를 안 부른다 — 로그인 없이 열리는 문이라 고객 이름 하나만 새도 사고다.
     */
    line: async (id) => {
      const r = SAMPLE.intake.find((x) => x.id === id);
      if (!r) return null;
      const 이름표: Record<string, string> = {
        plate: '차량번호', customer: '임차인', model: '모델명', supplier: '공급사', channel: '영업채널',
        agent: '영업담당자', product: '상품 구분', billMonth: '청구월', receivedAt: '접수일', deliveredAt: '인도일',
        term: '계약 기간', rent: '렌탈료', deposit: '보증금', payKind: '납입 방식', claim: '청구액', pay: '지급액',
        paper: '계약서', delivered: '인도완료', billed: '청구서 나감', intakeKind: '접수 갈래', note: '비고',
        stage: '지금 어디', claimStage: '청구 축', payStage: '지급 축', code: '원자 코드',
      };
      return Object.entries(r)
        .filter(([k, v]) => k !== 'id' && v !== '' && v !== false && v !== 0 && v !== undefined)
        .map(([k, v]) => ({ key: k, label: 이름표[k] || k, value: String(v) }));
    },
    car: async (plate) => (plate === '11가1111'
      ? {
        plate, found: true, model: '기아 니로 SG2 에어', supplier: '차카렌터카', product: '중고구독',
        year: '2023', status: '출고가능',
        /** 지어낸 사진 — 미리보기에 진짜 매물 사진을 싣지 않는다. */
        photo: 'https://placehold.co/800x600/1f2937/e5e7eb?text=%EC%B0%A8%EB%9F%89+%EC%82%AC%EC%A7%84',
        price: { '12': { rent: 770000, deposit: 1540000 }, '24': { rent: 730000, deposit: 1460000 }, '36': { rent: 700000, deposit: 1400000 } },
        spec: {
          car_number: '11가1111', model: '니로', sub_model: '니로 SG2', trim_name: '에어',
          year: '2023', first_registration_date: '2023-04-19', mileage: '32,000', fuel_type: '하이브리드',
          vehicle_class: '소형 SUV', seats: '5', ext_color: '흰색', int_color: '검정', drive_type: '2WD',
          battery_capacity: '68', options: '기본-컴포트', origin: '국산', vin: 'KNACP811FRA0XXXXX',
          provider_name: '차카렌터카', provider_company_code: 'RP0XX', product_type: '중고구독',
          product_code: 'RP0XX_11가1111', vehicle_status: '출고가능', status_kind: '가용',
        },
      }
      : null),
  }), []);
  return api;
}

export default function SettlementBoardPreview() {
  const api = useSampleApi();
  return <SettlementBoard api={api} preview />;
}

/** 고전 ERP 접수 워크스테이션도 «같은 샘플»로 본다. */
export function IntakeStationPreview() {
  const api = useSampleApi();
  return <IntakeStation api={api} preview />;
}
