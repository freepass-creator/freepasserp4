/**
 * **놓치면 안 되는 것을 세운다 — 접수부터 청구까지.** 순수 함수.
 *
 * ★사장님 2026-08-26
 *   「계약접수가 되면 추적관리해서 청구까지 해야하는거고 청구가 안된거를 뭔가 안정장치로 누락안되게」
 *   「그리고 분납건도 모니터링 확실하게 되게끔」
 *   「아이콘 모양이나 상태표시같은거를 잘해야함」
 *
 * ★★**누락은 «조용해서» 생긴다.** 청구를 안 한 건은 아무 일도 안 일어난다 —
 *   화면이 가만히 있으면 그대로 다음 달로 넘어가고, 넘어가면 아무도 다시 안 본다.
 *   그래서 «가만히 있는 것»을 찾아 **앞에 세우는** 것이 이 파일이 하는 일이다.
 * ★★**급수는 «돈이 새고 있나»로 매긴다.** 보기 싫은 것이 아니라 잃는 것이 급한 것이다.
 *   급수를 남발하면 사람이 빨강을 무시하게 된다 — 오늘 그걸 한 번 겪었다(검증기 빨강).
 * ⚠ 아이콘 이름만 정한다. **그리는 것은 화면이 한다** — 여기서 색·크기를 정하면
 *   화면마다 다르게 그려지고, 그러면 같은 상태가 화면마다 달라 보인다.
 */
import { billStateOf, type BillState } from './settlement-billstate';
import { brokenOf, midnight, nextInstalment, paidRoundsOf, roundsOf, type SettlementRow } from './settlement-stage';

/** 급수 — **돈이 새고 있나**로 매긴다. */
export type AlertLevel = '급함' | '살필것';

export type Alert = {
  /** 무슨 일인가 — 화면·보고서가 같은 말을 쓰도록 여기서 정한다. */
  kind:
  | '청구누락' | '청구지연'
  | '분납임박' | '분납지남' | '분납부러짐'
  | '인도지연' | '서류없이인도'
  | '환수미완' | '취소인데인도'
  | '청구액없음';
  level: AlertLevel;
  /** 사람이 읽는 한마디 */
  label: string;
  /** 왜 급한가 · 무엇을 해야 하나 */
  todo: string;
  /** lucide 아이콘 이름. **화면이 그린다** — 여기서 색·크기는 안 정한다. */
  icon: string;
};

const p2 = (n: number) => String(n).padStart(2, '0');
const ymOf = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
const daysBetween = (a: Date, b: Date) => Math.round((+midnight(a) - +midnight(b)) / 86_400_000);

/** 며칠이 지나면 「묵었다」고 볼 것인가. 접수만 하고 인도가 안 되는 건 이쯤부터 이상하다. */
export const STALE_DAYS = 45;
/** 며칠 앞부터 「임박」인가. 다음 회차를 챙길 여유. */
export const SOON_DAYS = 7;

export type AlertContext = {
  /** 발행된 청구서 열쇠 모음 — 「청구완료」 판정에 쓴다. */
  issued: Set<string>;
  now?: Date;
};

/**
 * 한 줄이 지금 무엇을 놓치고 있나. **아무것도 없으면 빈 배열** — 지어내지 않는다.
 *
 * 보는 순서가 곧 규칙이다 —
 * ```
 * ① 돈이 이미 샜나        취소인데 인도 · 청구액 0
 * ② 돈이 새는 중인가       청구 누락 · 지연
 * ③ 곧 샐 수 있나         분납 부러짐 · 지남 · 임박
 * ④ 앞이 막혀 있나        인도 지연 · 서류 없이 인도 · 환수 미완
 * ```
 */
export function alertsOf(r: SettlementRow, ctx: AlertContext): Alert[] {
  const now = ctx.now || new Date();
  const out: Alert[] = [];
  if (r.cancelled && !r.delivered) return out; // 인도 전 취소 — 더 볼 것이 없다

  const state: BillState = billStateOf(r, ctx.issued, now);
  const thisMonth = ymOf(now);

  // ① 돈이 이미 샜나
  if (r.cancelled && r.delivered && !r.clawback) {
    out.push({
      kind: '취소인데인도', level: '급함', icon: 'AlertOctagon',
      label: '취소인데 인도까지 갔다',
      todo: '인도했으면 청구가 섰던 건입니다. 환수를 켜거나, 인도일이 잘못 들어갔는지 보세요.',
    });
  }
  if (r.delivered && !r.cancelled && !r.claimWritten && !r.supplierRate) {
    out.push({
      kind: '청구액없음', level: '급함', icon: 'CircleDollarSign',
      label: '청구액이 안 잡힌다',
      todo: '요율도 적힌 값도 없습니다. 이대로 두면 이 건은 그냥 안 청구됩니다.',
    });
  }

  // ② 돈이 새는 중인가 — **가만히 있어서 생기는 누락**
  if (state === '미청구') {
    const m = String(r.deliveredAt ? ymOf(r.deliveredAt) : '');
    const late = m && m < thisMonth;
    out.push(late
      ? {
        kind: '청구지연', level: '급함', icon: 'AlarmClockOff',
        label: '청구월이 지났는데 청구서가 안 나갔다',
        todo: '지난 달 건입니다. 지금 발행하지 않으면 그대로 묻힙니다.',
      }
      : {
        kind: '청구누락', level: '살필것', icon: 'FileWarning',
        label: '이 달 청구서가 아직 안 나갔다',
        todo: '영업자 확인을 받고 청구서를 발행하세요.',
      });
  }

  // ③ 곧 샐 수 있나 — 분납
  if (roundsOf(r.payKind) >= 2 && r.delivered && !r.cancelled) {
    const paid = paidRoundsOf(r, now);
    const total = roundsOf(r.payKind);
    if (brokenOf(r, now)) {
      out.push({
        kind: '분납부러짐', level: '급함', icon: 'Unlink',
        label: `분납이 ${paid}/${total} 회에서 멈췄다`,
        todo: '받아야 할 날이 지났습니다. 환수 금액을 정해 처리하세요.',
      });
    } else {
      const next = nextInstalment(r, now);
      if (next) {
        const left = daysBetween(next, now);
        if (left <= SOON_DAYS) {
          out.push({
            kind: '분납임박', level: '살필것', icon: 'CalendarClock',
            label: left <= 0 ? '다음 회차일이다' : `다음 회차까지 ${left}일`,
            todo: `${paid + 1}/${total} 회차가 들어오는지 보세요. 안 들어오면 납입회차를 ${paid} 로 박아 멈춰 세웁니다.`,
          });
        }
      }
    }
  }

  // ④ 앞이 막혀 있나
  if (!r.delivered && !r.cancelled && r.receivedAt) {
    const old = daysBetween(now, r.receivedAt);
    if (old >= STALE_DAYS) {
      out.push({
        kind: '인도지연', level: '살필것', icon: 'Hourglass',
        label: `접수한 지 ${old}일인데 인도가 안 됐다`,
        todo: '인도되지 않으면 청구월이 서지 않습니다. 살아 있는 건인지 확인하세요.',
      });
    }
  }
  if (r.delivered && !r.paper && !r.cancelled) {
    out.push({
      kind: '서류없이인도', level: '살필것', icon: 'FileX2',
      label: '계약서 없이 인도됐다',
      todo: '계약서를 받았는지 보고 체크하세요.',
    });
  }
  if (r.clawback && (!r.clawbackAt || !r.clawbackAmount)) {
    out.push({
      kind: '환수미완', level: '살필것', icon: 'RotateCcw',
      label: '환수인데 날짜나 금액이 없다',
      todo: '환수일이 없으면 어느 달에서 뺄지 못 정합니다.',
    });
  }

  return out;
}

/** 한 줄의 급수 — 가장 센 것. 없으면 빈 문자열. */
export const levelOf = (alerts: Alert[]): AlertLevel | '' =>
  (alerts.some((a) => a.level === '급함') ? '급함' : alerts.length ? '살필것' : '');

/** 몇 건이 무엇에 걸려 있나. 화면 위·보고서가 같이 쓴다. */
export function countAlerts(all: Alert[][]): { kind: Alert['kind']; level: AlertLevel; n: number }[] {
  const m = new Map<string, { kind: Alert['kind']; level: AlertLevel; n: number }>();
  for (const list of all) {
    for (const a of list) {
      const c = m.get(a.kind) || { kind: a.kind, level: a.level, n: 0 };
      c.n += 1;
      m.set(a.kind, c);
    }
  }
  // 급한 것이 앞이다 — 목록을 위에서부터 읽는다.
  return [...m.values()].sort((x, y) => (x.level === y.level ? y.n - x.n : x.level === '급함' ? -1 : 1));
}
