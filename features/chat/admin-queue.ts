import { STEPS, isDone, isRejected, isContractCancelled, isContractCompleted } from '@/lib/domain/contract';
import { type EntityRecord } from '@/lib/intake/entities';

/**
 * 관리자 응대 큐 — 「지금 내가 눌러야 넘어가는 방」을 가른다.
 *
 * **별도 페이지를 두지 않는다**(2026-08-08 사장님 결정). 관리자가 계약문의(`/chat`)에 들어가면
 * 관리자에게 맞는 화면이 나온다 — 같은 목록에 「내 차례」 필터와 «오래 기다린 순»이 붙는 방식이다.
 * 화면을 하나 더 만들면 같은 방을 두 곳에서 관리하게 되고, 둘은 반드시 어긋난다.
 *
 * 공급사는 시트로 관리한다(앱에 안 들어온다, 2026-08-07 결정). 그래서 계약 5단계의
 * **공급 몫 체크는 실제로 운영자가 처리한다** — 관리자의 큐는 곧 공급 몫 대기열이다.
 *
 * ★안읽음과는 **다른 축**이다. 안읽음 = 말이 왔나 / 큐 = 일이 걸렸나.
 *   둘을 한 목록에 섞으면 둘 다 못 쓴다(읽었는데 처리는 안 끝난 방이 사라져 버린다).
 *
 * 순수 함수다 — 저장소·화면을 모른다. 시험 가능해야 규칙이 조용히 어긋나지 않는다.
 */

export type DeskBucket =
  | 'mine'    // 내 차례 — 운영이 눌러야 다음으로 간다
  | 'waiting' // 영업자 차례 — 우리가 할 일은 없다
  | 'done';   // 완료·취소 — 큐에서 내려간다

export type DeskItem = {
  room: EntityRecord;
  contract: EntityRecord | null;
  bucket: DeskBucket;
  /** 행에 뜨는 한마디 — mine이면 내가 누를 것, waiting이면 기다리는 것. */
  nextLabel: string;
  /** 정렬 기준(오름차순 = 오래 기다린 것 먼저). 방의 마지막 대화 시각. */
  sinceAt: number;
};

/** 계약이 아직 없을 때 — 영업자가 말을 걸었으면 첫 응답이 우리 몫이다. */
function noContractItem(room: EntityRecord): { bucket: DeskBucket; nextLabel: string } {
  const lastRole = String(room.last_sender_role || '');
  const hasTalk = Number(room.last_message_at) > 0;
  if (!hasTalk) return { bucket: 'waiting', nextLabel: '대화 없음' };
  if (lastRole === 'agent') return { bucket: 'mine', nextLabel: '첫 응답' };
  return { bucket: 'waiting', nextLabel: '영업자 대기' };
}

/**
 * 한 방의 처리 상태.
 *
 * 「다음 미완 체크」 하나로 판정한다 — 단계는 순서대로 진행되고, 한 단계 안에서도
 * 앞선 체크가 끝나야 뒤가 의미를 갖기 때문이다(입금 전에 입금확인이 있을 수 없다).
 */
export function deskItemOf(room: EntityRecord, contract: EntityRecord | null): DeskItem {
  const sinceAt = Number(room.last_message_at) || 0;
  if (!contract) return { room, contract: null, sinceAt, ...noContractItem(room) };
  if (isContractCancelled(contract)) return { room, contract, sinceAt, bucket: 'done', nextLabel: '취소' };
  if (isContractCompleted(contract)) return { room, contract, sinceAt, bucket: 'done', nextLabel: '완료' };

  for (const step of STEPS) {
    for (const ch of step.checks) {
      const cur = contract[ch.key];
      if (isDone(cur)) continue;
      // 부결·출고불가로 막힌 건은 우리가 더 누를 게 없다 — 영업자가 접거나 다시 물어야 한다.
      //  큐에 남겨 두면 «내 차례»가 영영 안 비워진다.
      if (isRejected(cur)) {
        return { room, contract, sinceAt, bucket: 'waiting', nextLabel: `${String(cur)} · 영업자 확인` };
      }
      return ch.actor === 'provider'
        ? { room, contract, sinceAt, bucket: 'mine', nextLabel: ch.label }
        : { room, contract, sinceAt, bucket: 'waiting', nextLabel: `영업 ${ch.label} 대기` };
    }
  }
  // 5단계 체크는 다 끝났는데 완료 처리가 안 된 상태(정산 실패 등) — 운영이 마무리해야 한다.
  return { room, contract, sinceAt, bucket: 'mine', nextLabel: '완료 처리' };
}

/**
 * 오래 기다린 것 먼저.
 *
 * 최신순으로 두면 **오래된 건이 영원히 목록 아래에 깔린다** — 응대의 정의에 어긋난다.
 * 대화가 아직 없는 방(sinceAt=0)은 기다림의 대상이 아니므로 맨 뒤로 보낸다.
 */
export function sortDeskQueue(items: DeskItem[]): DeskItem[] {
  return items.slice().sort((a, b) => {
    if (!a.sinceAt !== !b.sinceAt) return a.sinceAt ? -1 : 1;
    return a.sinceAt - b.sinceAt;
  });
}

