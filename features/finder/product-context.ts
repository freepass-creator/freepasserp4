import type { EntityRecord } from '@/lib/intake/entities';
import { actor, ensureRoom, getRole, ROLE_LABEL } from '@/lib/domain/deal';
import { getSession } from '@/lib/auth-session';
import { formatProductForCopy, guestShareUrl } from '@/lib/domain/product-share';
import { copyText } from '@/lib/clipboard';
import { toast } from '@/components/Toaster';
import type { CtxItem } from '@/components/ui/ContextMenu';

export function buildProductContextItems(
  product: EntityRecord,
  navigate: (href: string) => void,
): CtxItem[] {
  const role = getRole();
  const canDeal = role === 'agent' || role === 'admin';
  const session = getSession();
  const currentActor = actor(role);
  const items: CtxItem[] = [];

  if (canDeal) {
    items.push({
      label: '계약문의',
      onClick: async () => {
        try {
          const room = await ensureRoom(product, currentActor);
          navigate(`/chat?room=${encodeURIComponent(room)}`);
        } catch (error) {
          toast(error instanceof Error ? error.message : '계약문의 실패', 'error');
        }
      },
    });
    items.push({
      label: '공유',
      onClick: async () => {
        const url = guestShareUrl(product, currentActor.code || currentActor.uid);
        if (await copyText(url)) toast('손님용 매물 링크 복사됨', 'ok');
        else toast('링크를 복사하지 못했습니다', 'error');
      },
    });
    items.push({ divider: true });
  }

  items.push({
    label: '상품 내용 복사',
    onClick: async () => {
      const text = formatProductForCopy(product, {
        name: session?.name || currentActor.name,
        company: session?.company_code,
        roleLabel: ROLE_LABEL[role],
      });
      if (await copyText(text)) {
        toast(`상품 내용 복사됨 — ${product.car_number || product.product_code}`, 'ok');
      } else {
        toast('상품 내용을 복사하지 못했습니다', 'error');
      }
    },
  });
  items.push({
    label: '상세 보기',
    onClick: () => navigate(`/m/${encodeURIComponent(String(product.product_code))}`),
  });
  return items;
}
