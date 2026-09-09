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
  rows: [],
  found: [
    { id: 'y1', code: 'stl_sample1', plate: '11가1111', customer: '김샘플', supplier: '차카렌터카', channel: '하나채널', agent: '이보기', product: '선출고', billMonth: '2026-08', receivedAt: '2026-08-04', deliveredAt: '2026-08-12', claim: 616200, pay: 474000, stage: '청구', claimStage: '청구', payStage: '통보', invoiceIssued: false, invoiceAt: '', note: '2회분납 1회차', carryNote: '' },
    { id: 'y2', code: 'stl_sample2', plate: '22나2222', customer: '이보기', supplier: '마바모빌리티', channel: '하나채널', agent: '최예제', product: '신차발주', billMonth: '2026-08', receivedAt: '2026-08-20', deliveredAt: '2026-08-26', claim: 3783000, pay: 3783000, stage: '정정', claimStage: '정정', payStage: '확인', invoiceIssued: true, invoiceAt: '2026-09-07', note: '신차는 청구 = 지급 · 수익 0', carryNote: '다음 달에 계산서 수정' },
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

export default function SettlementBoardPreview() {
  const api = useMemo<BoardApi>(() => ({
    ready: true,
    load: async (month) => ({ ...SAMPLE, month: month || SAMPLE.month }),
    /** ⚠ 미리보기는 «안 쓴다». 눌러도 아무 데도 안 남는다고 그 자리에서 말해 준다. */
    save: async () => ({ ok: false, error: '미리보기라 저장되지 않습니다 — 얼굴만 보는 문입니다' }),
    car: async (plate) => (plate === '11가1111'
      ? { plate, found: true, model: '기아 니로 SG2 에어', supplier: '차카렌터카', product: '구독', year: '2023', status: '출고가능',
          price: { '12': { rent: 770000, deposit: 1540000 }, '24': { rent: 730000, deposit: 1460000 }, '36': { rent: 700000, deposit: 1400000 } } }
      : null),
  }), []);
  return <SettlementBoard api={api} preview />;
}
