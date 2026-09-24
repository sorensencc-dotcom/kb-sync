---
source: grok
skill: drive-it
topic: cic
title: "Cuban Seizures Source Audit"
created: Wed Sep 23 2026 18:56:25 GMT-0400 (Eastern Daylight Time)
folder_id: 1Faya0q0j3S62NGq_U-nxrefwbwfGQq0g
status: drop
provenance_type: mobile_inbox_drop
content_sha256: 9246e0990fae785cf28908e6230678e608ed34818879a71f883c7c8c2e8da77e
---

# Cuban Seizures Source Audit

## Context

Chris submitted a five-track brief on CESOR Cuban land, FCSC mining valuations, Augustinian non-stock appraisal, Ford/Willys Cuban finance vs Willow Run, and a KIS-P notebook-sync fix. Grok audited the brief against public FCSC PDFs, the Acc. 38 finding aid, and the published agrarian-reform record. Track 1 (Bentley Box 14 / CU-3440 / Herman as Cuban-agriculture proof) failed. Tracks 2–4 rest on real Title V decisions but are comparative, not family. Track 5 is Desktop ingest only.

No FCSC Title V decision located under Charles E. Sorensen, Helen Mitchell Sorensen, or Clifford Sorensen. Wikipedia’s “extensive Cuban land holdings seized” line remains INFERRED. Miami-Dade 1959 Helen inventory stays the live estate path (letter already mailed). BFRC packet still unsent.

## Payload

### User asks
- Five-track Cuban-seizures / FCSC / KIS-P brief.
- Pull full CU-2624 and CU-2619 PDFs for discount-rate tables only.
- Confirm: “so nothing for sorensen.”
- `drive-it cic`.

### Decisions
- Do not request Bentley Historical Library “Charles E. Sorensen Papers 1904–1965 Box 14.” Collection not found.
- Acc. 38 Box 14 is Foreign Ford Companies (Finland / France / Germany), not Cuban deeds. Do not write Series 64.167.38.
- Do not treat CU-3440 (Central West Company / Havana Lithographing precedent) or CU-5843 as Sorensen claims.
- Do not cite Herman, Freedom’s Forge pp. 242 / 342–343 for citrus or cattle.
- Do not state that CESOR holds a certified FCSC award.
- Do not run catalog_ingest from this chat.
- Do not ingest “Bentley Box 14” or “CU-3440 = Sorensen” into pack_cuban_seizures.txt.

### VERIFIED comparative dockets (not family)
- CU-2624 Nicaro Nickel. Oral hearing 16 Sep 1971 VERIFIED. Proposed 30 Jun 1971: proven only @ 12% = $22,297,708.62 ore + $197,000 other = $22,494,708.62. Final: 8% proven / 12% probable / 15% possible. Ore PV $32,817,082.52 + $197,000 = certified $33,014,082.52 + 6% from 24 Oct 1960. Behre Dolbear Aug 1971 asked 8% flat; Commission kept risk tiers. Year-end convention 1/(1+r)^n, 1961 = year 1.
- CU-2625 Freeport / Islexco. Filed $387,000. Asserted gross in-ground ore $1,113,093,516. DENIED in full 8 Sep 1971.
- CU-2619 Moa Bay. Certified $88,349,000 as of 19 Aug 1960. No year-by-year PV table in the opinion. Sanderson & Porter 6 Mar 1957: 50M lb Ni + 4.4M lb Co/yr × 22 years. Gross refined $45.1M/yr to 30 Jun 1965, then $42.9M. Reinvestment $9,656,000 (3% compound → 12% discount) DENIED. 12% is explicit on that denied increment; Nicaro’s proposed decision cites Moa as the 12% Cuba-mining precedent.
- CU-2573 Cuban American Nickel. DENIED (U.S. Louisiana plant; offtake contract only).
- CU-3503 Augustinians. Certified $7,885,098.68; Villanueva $5,071,590.42.
- CU-3072 Ford / Credesco. Adjusted equity $169,046.42; certified $173,943.42. Denied $39,274.58 profits and 1,775,000-peso guarantees. Hearing on record 8 Sep 1971.
- CU-0502 William A. Powe / Willys Cuban franchise. 4,963 of 8,532 shares → $637,447.72 on that block.

### Artifact paths
- artifacts/CIC_Cuban_Seizures_Track_Source_Audit.docx
- artifacts/FCSC_Nicaro_Moa_Discount_Rate_Tables.xlsx
- artifacts/fcsc/CU-2624_Nicaro.pdf
- artifacts/fcsc/CU-2619_2573_Moa.pdf
- Prior (unchanged): artifacts/Miami-Dade_Probate_Request_Helen_Mitchell_Sorensen_1959.docx (mailed; do not redraft)
- Prior (unchanged): artifacts/BFRC_Request_Acc38_Acc65_SE007_Sorensen.docx (not sent)

## Next

Desktop catalog_ingest / morning pipeline picks this up. Tag CU-2624 / CU-2619 / CU-2625 / CU-3503 / CU-3072 / CU-0502 as COMPARATIVE, not FAMILY. Do not freeze Bentley Box 14 or CU-3440 = Sorensen into the master workspace cache.
