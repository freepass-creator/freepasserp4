'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * 이 요소가 «화면에 들어왔나» — 한 번 들어오면 계속 참이다(래치).
 *
 * ★왜 래치인가: 목록을 위아래로 굴릴 때마다 껐다 켜면 이미 푼 사진을 다시 풀거나,
 *   막 채워진 사진이 사라졌다 나타난다. 우리가 알고 싶은 건 「지금 보이나」가 아니라
 *   **「한 번이라도 볼 만했나」**다 — 그때부터는 무거운 일을 해도 된다.
 *
 * ★`rootMargin` 만큼 «미리» 켠다. 화면에 닿는 순간 시작하면 사진이 눈앞에서 채워져
 *   깜빡이는 것처럼 보인다. 한 화면 앞서 시작해 두면 도착할 때쯤 이미 떠 있다.
 *
 * ⚠ IntersectionObserver 가 없는 환경(아주 오래된 브라우저·일부 테스트 러너)에서는
 *   **처음부터 참**으로 둔다. 게으르게 하려다 «영영 안 뜨는» 쪽이 훨씬 나쁘다.
 */
export function useInView<T extends Element>(rootMargin = '600px'): {
  ref: React.RefObject<T>;
  inView: boolean;
} {
  // ⚠ `useRef<T | null>` 로 두면 RefObject<T|null> 이 되어 JSX ref 에 못 꽂힌다(LegacyRef 불일치).
  const ref = useRef<T>(null as unknown as T);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;                       // 래치 — 한 번 켜지면 관찰을 그만둔다
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const el = ref.current;
    if (!el) { setInView(true); return; }     // 붙일 데가 없으면 게으름을 포기한다(안 뜨는 것보다 낫다)
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setInView(true);
    }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);

  return { ref, inView };
}
