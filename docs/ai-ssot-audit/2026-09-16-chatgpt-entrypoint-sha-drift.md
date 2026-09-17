# 2026-09-16 ChatGPT independent SSOT audit — Claude entry-point SHA drift

## Finding

`CLAUDE-AUDIT.md` at main commit `7f942cb59bd0cf77838c31681aae18f1a81bc1a5` stated that the post-audit application change was commit `b7942ed59026041e29e21cbd80ec28b19da32840`. Direct GitHub commit lookup shows that SHA does not exist in `freepass-creator/freepasserp4`.

The actual PR #334 application commit is:

- `b794345499bbcbc467462dfd1e25a46bea42c6d9`
- title: `사진이 6.4초에 «출발»했다 — 첫 화면 카드를 서버가 그리고, preload 를 사진에 돌려준다 (#334)`

Its diff is limited to shop presentation/SSR/image-preload work, including `app/(shop)/shop/ShopView.tsx` and `app/(shop)/shop/page.tsx`. It does not change the SSOT source registry, production engine pin, F01/F86 writers, ERP5 collector, mirror topology, settlement orchestration, or canonical product-type/color contract.

Therefore the entry-point lineage reference was stale/incorrect, but audit `(18)`'s substantive SSOT conclusions remain valid.

## Current CI cross-check

Latest observed main CI run `35080449988` on the audit-document head still fails only at the already-recorded required `check:shop-data-parity` step. The failure is the same helper-vs-literal-regex checker-contract drift documented in audit `(18)`; `check:store` remains at RTDB direct-open baseline 0 and the other preceding governance checks complete successfully.

No new SSOT implementation regression was established by this review.

## Unchanged open items

- production pin remains `2e880cefa96e3fa4bfc79902fed448d5bd74abdb`;
- current-main legacy same-output F01 writer conflict remains open;
- composite credential action load-time failure remains open;
- settlement `접수/취소` → ERP5 Atom lock orchestration gap remains open;
- pickup canonical color remains `#C2185B`;
- mirror/sales scheduled writer ownership remains open;
- a normal scheduled full F01/F86 audit success for the current `2e880cef...` semantics remains HOLD until independently evidenced.

Application code and business logic were not modified by this audit.