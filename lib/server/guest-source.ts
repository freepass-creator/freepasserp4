import { getFirestore } from 'firebase-admin/firestore';
import { firebaseAdminApp } from '@/lib/server/firebase-admin';

/**
 * **손님 화면이 읽는 원자 — «잠깐 담아 둔다».**
 *
 * ★★사장님 2026-09-07 「상세페이지가 왜 이렇게 늦게 불러오는 중이 오래 걸리지?」.
 *   실측 — `v4/products` 통째 읽기가 **776ms**(첫 회)·400ms(이후)다. 손님이 목록을 열 때도,
 *   카드를 눌러 상세로 갈 때도, 카톡 미리보기가 긁을 때도 **매번** 1,375대를 통째로 읽었다.
 *   ⇒ 서버 안에 **15초**만 담아 둔다. 같은 짧은 창의 손님들은 읽기 없이 바로 받는다.
 *
 * ⚠⚠ **이건 «어디서 읽나»를 바꾸는 게 아니다.** 원천은 여전히 ERP 하나다
 *   (집 규격 「화면이 시트를 직접 읽지 않는다」와 부딪히지 않는다 — 그건 «다른 원천»을 금하는 규칙이고
 *   이건 «같은 원천»을 잠깐 담는 것이다). 대수가 두 군데서 세어지는 일도 없다 — 세는 곳은 그대로다.
 * ★15초인 이유 — 화면은 45초마다 다시 묻는다. 둘을 합쳐도 갱신 뒤 지난 상태가 화면에
 *   남는 상한은 60초다. 계약 선점(계약중)도 그 안에 두 사람이 부딪힐 일은
 *   목록 화면에서 일어나지 않는다(선점은 계약 단계에서 엔진이 잡는다).
 * ⚠ 담는 곳은 «서버 한 대»의 기억이다. 서버가 여럿이면 각자 담는다 — 그래도 15초다.
 * ★비우고 싶으면 서버를 다시 띄우면 된다. 굳는 값이 아니다.
 */
type Rec = Record<string, unknown>;
type Snap = { at: number; products: Record<string, Rec>; policies: Record<string, Rec> };

const TTL_MS = 15_000;
let snap: Snap | null = null;
let inflight: Promise<Snap> | null = null;

/** 목록·상세가 같은 정책 문서 키/정책코드 규칙을 쓴다. */
export function findGuestPolicy(policies: Record<string, Rec>, policyCode: unknown): Rec | null {
  const code = String(policyCode ?? '').trim();
  if (!code) return null;
  return Object.entries(policies)
    .map(([key, value]) => ({ ...(value || {}), _key: key } as Rec))
    .find((policy) => String(policy.policy_code ?? '').trim() === code || String(policy._key ?? '').trim() === code) || null;
}

async function read(): Promise<Snap> {
  const db = getFirestore(firebaseAdminApp());
  const asMap = (snap: FirebaseFirestore.QuerySnapshot, name: string): Record<string, Rec> => {
    const out: Record<string, Rec> = {};
    for (const doc of snap.docs) {
      const value = doc.data() as Rec;
      const key = String(value._key || doc.id);
      if (out[key]) throw new Error(`Firestore ${name} canonical key conflict`);
      out[key] = value;
    }
    return out;
  };
  const [p, q] = await Promise.all([db.collection('products').get(), db.collection('policy').get()]);
  return {
    at: Date.now(),
    products: asMap(p, 'products'),
    policies: asMap(q, 'policy'),
  };
}

/**
 * 재고 + 정책을 한 번에. 담아 둔 것이 싱싱하면 그것을, 아니면 새로 읽는다.
 * ★같은 순간에 여럿이 물으면 **읽기는 한 번**이다(`inflight`) — 첫 손님이 읽는 동안
 *   뒤이어 온 손님들이 각자 또 읽으면 그게 제일 느린 순간에 부하를 겹쳐 놓는 꼴이다.
 */
export async function guestSource(): Promise<Snap> {
  if (snap && Date.now() - snap.at < TTL_MS) return snap;
  if (inflight) return inflight;
  inflight = read()
    .then((s) => { snap = s; return s; })
    .finally(() => { inflight = null; });
  return inflight;
}
