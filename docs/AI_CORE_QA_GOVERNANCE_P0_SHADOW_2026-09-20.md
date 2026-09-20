# ERP4 ↔ AI Core QA / Governance P0 SHADOW

Status: SHADOW_WITH_GAPS / NO RELEASE AUTHORITY TRANSFER

AI Core candidates:
- QA/Observability PR #157 @ 584026ecaaac40073aeac5a775a5144bf704d0c8
- Build/Deploy/Governance PR #154 @ 8bd7fb26338b32abca914995fcd767c8e131ab03

ERP4 baseline:
- f01b91c7f68fc2f55d8d642bc3d39f5e07368967

## QA mapping

The existing ERP4 checker manifest is projected as:

- required -> REQUIRED
- manual -> MANUAL
- pending -> PENDING
- known_bad -> negative control PROVEN
- known_bad_pending / no known_bad -> negative control PENDING

At the pinned baseline:

- required: 33
- manual: 10
- pending: 9
- required negative-control PROVEN: 5
- required negative-control PENDING: 28

Therefore the honest candidate result is not “QA conformant”. It is:

`SHADOW_PARITY_WITH_GAPS`

The important success is that the candidate contract can represent both the strong gates and the known blind spots without converting unknown evidence into PASS.

## Governance mapping

ERP4 already has project-owned release semantics:

```
main
→ Vercel deployment
→ freepasserp.com / www
→ /api/version revision readback
```

This maps cleanly to the Governance candidate's expected revision, deployment identity and production observation fields.

Rollback evidence is also project-owned and remains in ERP4 docs/runbooks.

## Intentional gap

`deploy:verify` proves served revision identity. It does not by itself prove every critical runtime smoke scenario.

The SHADOW therefore leaves:
- production observation: not observed by this CI
- runtime smoke binding: partial

and does not manufacture a VERIFIED release.

## No-touch boundary

This PR does not:
- deploy ERP4;
- repair aliases;
- change domains;
- change Firebase/Vercel settings;
- change current CI gates;
- change checker classifications;
- change production data;
- change branch protection.

It only proves static semantic representability against the candidate Core contracts.
