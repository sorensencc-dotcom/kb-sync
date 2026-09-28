---
title: cic-cuban-seizures-retired-assets
category: wiki
status: draft
sourceRepository: kb-sync
---
# Daily Synthesis Log: CIC - Cuban Seizures & Retired Assets — 2026-09-24

| Metadata | Value |
|---|---|
| **Notebook** | CIC - Cuban Seizures & Retired Assets (`c8360946-dbee-4a2c-b622-7f89b05695b0`) |
| **Date** | 2026-09-24 |
| **Sessions active** | 1 |
| **Total turns** | 10 |
| **Content SHA-256** | `ba4e9d7a562bda4b...` |
| **Status** | SYNTHESIZED |

## Executive summary
Consolidated 10 discussion turn(s) across 1 active session(s) on 2026-09-24. Grounded facts, verified timeline assertions, and open inquiries were cataloged for downstream knowledge base indexing.

## Key decisions & verified timeline facts
- **Q:** What open questions or unresolved contradictions exist across these sources?
  **Outcome:** An examination of the Foreign Claims Settlement Commission (FCSC) adjudications, corporate dossiers, and industrial memoirs reveals several core **legal, methodological, and procedural contradictions** alongside open structural questions across these sources:

---

### 1. Valuation Methodology Diver...
- **Q:** What claims are asserted but single-sourced or under-corroborated?
  **Outcome:** Under **Title V of the International Claims Settlement Act of 1949**, the Foreign Claims Settlement Commission (FCSC) strictly enforced the statutory rule that the claimant bears the primary burden of proof on all issues [1, 2]. Because many claimants fled Cuba hastily following the 1959 Revolution,...
- **Q:** The submitted brief is a mixed pack. Tracks 2–4 sit on real FCSC PDFs. Track 1 does not. Track 5 is Desktop ingest, not an archive.

Full markup is in `artifacts/CIC_Cuban_Seizures_Track_Source_Audit.docx`.

**Do not use from Track 1**
- Bentley Historical Library “Charles E. Sorensen Papers (1904–1965), Box 14.” No such collection found. CESOR’s known papers are THF Acc. 38 at BFRC, 1913–1946. Acc. 38 Box 14 is Foreign Ford Companies — Finland / France / Germany — not Cuban deeds.
- CU-3440 and CU-5843 as Sorensen equity claims. CU-3440 is Central West Company (Havana Lithographing $2.51/share precedent). CU-5843 not retrieved.
- Herman, *Freedom’s Forge* pp. 242, 342–343 as proof of Cuban groves. That book is Willow Run / Knudsen / Kaiser.

**CESOR × Cuba — what is actually on the record**
- Wikipedia: “extensive land holdings in Cuba (which were seized…).” No docket attached. **INFERRED.**
- No Title V decision located under Charles E., Helen Mitchell, or Clifford Sorensen. **UNKNOWN.**
- First Agrarian Reform Law / INRA, 17 May 1959: **VERIFIED** as statute, not as applied to a named Sorensen tract.
- Highest-yield next document is still the already-mailed 1959 Helen Mitchell Sorensen Miami-Dade inventory. Do not redraft that letter.

**VERIFIED comparative dockets (not family claims)**

| Docket | Result |
|---|---|
| CU-2624 Nicaro Nickel | Certified **$33,014,082.52**. Behre Dolbear report Aug 1971. Proposed ~$22.49M raised on objection. |
| CU-2625 Freeport / Islexco | **Denied.** Filed **$387,000**. The **$1.113B** figure is asserted *gross in-ground ore*, not a certified award. Idle concessions, no commercial value. |
| CU-3503 Augustinians | Certified **$7,885,098.68**; Villanueva **$5,071,590.42**. §502(1)(B) standing. |
| CU-3072 Ford / Credesco | Adjusted equity **$169,046.42**; certified **$173,943.42**. Denied $39,274.58 profits and 1,775,000-peso bank guarantees. Hearing on record 8 Sep 1971. |
| CU-0502 Powe / Willys franchise | 4,963 of 8,532 shares; **$637,447.72** on that block. Nationalized 24 Oct 1960. |

16 Sep 1971 as the Nicaro *oral* hearing date: **NEEDS-REVIEW**. Finals for Freeport and Credesco cluster on 8 Sep 1971.

**Track 5** — workspace `c8360946-…`, `consolidate-pack.mjs`, `pack_cuban_seizures.txt`: Desktop `catalog_ingest` only. Do not freeze “Bentley Box 14” or “CU-3440 = Sorensen” into the master cache.

**Next, if you want a retrieval action**
1. Leave Miami-Dade and BFRC as they stand.
2. Say whether to pull the full CU-2624 / CU-2619 PDFs for the discount-rate tables only.
3. Say `drive-it cic` if this audit should land in the CIC drop folder.
  **Outcome:** The audit corrections are locked in. The unverified Track 1 assertions have been purged from the analysis, and the desktop pipeline cache will reflect only verified dockets.

---

### 1. Track 1 Purge & Status Corrections
* **Bentley Historical Library Box 14:** **DROPPED.** Confirmed that Sorensen'...
- **Q:** Check ITT or Moa Bay hearing dates
  **Outcome:** Here are the exact decision and hearing dates for **Moa Bay Mining** and **ITT** from the Foreign Claims Settlement Commission (FCSC) official record:

---

### 1. Moa Bay Mining Company (Claim CU-2619 & CU-2573 / Decision CU-6049)
* **Proposed Decision Issued:** **February 3, 1971** [1]
* **Final D...
- **Q:** 16 Sep 1971 Nicaro hearing is now **VERIFIED** on the Final Decision caption. Moa has no printed year-by-year PV table.

Official PDFs:  
`artifacts/fcsc/CU-2624_Nicaro.pdf`  
`artifacts/fcsc/CU-2619_2573_Moa.pdf`

Reconstructed tables:  
`artifacts/FCSC_Nicaro_Moa_Discount_Rate_Tables.xlsx`  
(blue = printed figure; black = formula)

**CU-2624 Nicaro — two holdings**

Proposed 30 Jun 1971: proven only, **12%**, citing Moa as precedent. Claimant’s 6/10/15 rejected as a Michigan industrial rate.

| | Printed |
|---|---|
| Proven PV @ 12%, 1961–1979 | $22,297,708.62 |
| Other assets | $197,000.00 |
| Proposed certification | $22,494,708.62 |

Final after 16 Sep 1971 hearing (Colligan; Thurston affidavit same day; Behre Dolbear Aug 1971 asked 8% on *all* classes). Commission allowed all three classes and split the rates:

| Class | Rate | Years | Printed PV |
|---|---|---|---|
| Proven | 8% | 1961–1979 | $30,257,020.00 |
| Probable | 12% | 1979–1984 | $1,930,982.52 |
| Possible | 15% | 1985–1992 | $629,080.00 |
| Ore PV | | | $32,817,082.52 |
| + other | | | $197,000.00 |
| **Final certification** | | | **$33,014,082.52** + 6% from 24 Oct 1960 |

Convention: year-end `1/(1+r)^n` with 1961 = year 1 from 24 Oct 1960. Factors on the page match that identity.  
OCR clean: 1988 possible-ore gross printed as $4,855,100; $4,055,100 × 0.019974 = the printed net $80,996.57. Flagged yellow in the sheet.

Gross build (Appendix D): 33,300,000 proven tons. 1.3 Mt/yr 1961–67 (U.S. offtake), 2.1 Mt/yr plant capacity through 1978, 1.1 Mt residual 1979. Zero opex deducted; Colligan affidavit that post-contract (after 10 Mar 1968) sales would be at least as favorable as the U.S. ore contract.

**CU-2619 Moa — stack, not a factor table**

Certified **$88,349,000** as of 19 Aug 1960. Opinion accepts Exhibit R as “fair and reasonable” and does **not** reprint the year-by-year factors.

| Line | Printed |
|---|---|
| Reserve (S&P 6 Mar 1957 / Pfleider) | 50 M lb Ni + 4.4 M lb Co / yr × 22 yrs, to 30 Jun 1982 |
| Gross refined / yr to 30 Jun 1965 | $45,100,000 |
| Gross refined / yr after | $42,900,000 |
| Plant salvage @ yr 22 | $11,600,000 |
| 22-yr income + salvage | $622,485,000 |
| Extract+refine (S&P) | $19,700,000 / yr |
| MOA opex 22 yrs | $264,418,000 |
| Interest | $9,816,000 |
| Cuban taxes | $104,012,000 |
| Undiscounted net | $244,239,000 |
| Exhibit R PV accepted | **$88,349,000** |
| Reinvestment $9,656,000 (3% compound → 12% discount) | **DENIED** |
| CU-2573 Cuban American | **DENIED** (U.S. plant; offtake contract only) |

**What the original brief got right / wrong**
- 8 / 12 / 15 is Nicaro *final*, not a universal FCSC mining schedule.
- Moa “22-year depletion” and “$45.1M gross annual refined value” are **VERIFIED**. The “12% on residual plant and equipment” line is only explicit on the *denied* reinvestment increment, not on the $88.3M award itself.
- 16 Sep 1971 oral hearing: **VERIFIED**.

Still comparative only. No CESOR docket in either PDF.
  **Outcome:** The primary PDF extractions lock in the exact legal, mathematical, and procedural distinctions between **Nicaro Nickel (CU-2624)** and **Moa Bay Mining (CU-2619)**.

---

### 1. Nicaro Nickel (CU-2624) — The Two-Stage Hearing Shift

The primary record verifies that the **8% / 12% / 15% tiered disco...

## Technical discoveries & entity linkages
- **Q:** What adjacent topics do these sources point to that aren't covered yet?
  **Finding:** The source records point to several major **legal, financial, administrative, industrial, and technical topics** that extend beyond standard corporate nationalization and property valuation disputes:

---

### 1. Foreign Exchange Restrictions and Currency Annulment Laws
* **Law 568 (Foreign Exchange...
- **Q:** What follow-up research would most strengthen current findings?
  **Finding:** Five primary follow-up research avenues would most effectively strengthen current findings, resolve valuation paradoxes, and bridge evidence gaps across these sources:

---

### 1. Primary Archival Extraction for the Charles E. Sorensen Estate
* **Historical Context:** Charles E. Sorensen's citrus g...
- **Q:** What adjacent topics do these sources point to that aren't covered yet?
  **Finding:** The source records point to several major **legal, financial, administrative, industrial, and technical topics** that extend beyond standard corporate nationalization and property valuation disputes:

---

### 1. Foreign Exchange Restrictions and Currency Annulments
* **Law 568 (Foreign Exchange Con...
- **Q:** What follow-up research would most strengthen current findings?
  **Finding:** Five primary follow-up research avenues would most effectively strengthen current findings, resolve valuation paradoxes, and bridge evidence gaps across these sources:

---

### 1. Primary Archival Extraction for the Charles E. Sorensen Estate
* **Historical Context:** Charles E. Sorensen's citrus g...
- **Q:** incorporate these verified discount and valuation
  **Finding:** I've initiated the creation of the updated **Legal Contradictions and Valuation Gaps in the FCSC Cuban Claims Program** report, incorporating the verified Nicaro and Moa Bay valuation mechanics as well as the purged Track 1 audit corrections. It will appear in your Studio panel shortly once generati...

## Unresolved questions & open contradictions
- What adjacent topics do these sources point to that aren't covered yet?: The source records point to several major **legal, financial, administrative, industrial, and technical topics** that extend beyond standard corporate nationalization and property valuation disputes:
...
- What follow-up research would most strengthen current findings?: Five primary follow-up research avenues would most effectively strengthen current findings, resolve valuation paradoxes, and bridge evidence gaps across these sources:

---

### 1. Primary Archival Ex...
- What open questions or unresolved contradictions exist across these sources?: An examination of the Foreign Claims Settlement Commission (FCSC) adjudications, corporate dossiers, and industrial memoirs reveals several core **legal, methodological, and procedural contradictions*...
- What claims are asserted but single-sourced or under-corroborated?: Under **Title V of the International Claims Settlement Act of 1949**, the Foreign Claims Settlement Commission (FCSC) strictly enforced the statutory rule that the claimant bears the primary burden of...
- What adjacent topics do these sources point to that aren't covered yet?: The source records point to several major **legal, financial, administrative, industrial, and technical topics** that extend beyond standard corporate nationalization and property valuation disputes:
...
- What follow-up research would most strengthen current findings?: Five primary follow-up research avenues would most effectively strengthen current findings, resolve valuation paradoxes, and bridge evidence gaps across these sources:

---

### 1. Primary Archival Ex...
- The submitted brief is a mixed pack. Tracks 2–4 sit on real FCSC PDFs. Track 1 does not. Track 5 is Desktop ingest, not an archive.

Full markup is in `artifacts/CIC_Cuban_Seizures_Track_Source_Audit.docx`.

**Do not use from Track 1**
- Bentley Historical Library “Charles E. Sorensen Papers (1904–1965), Box 14.” No such collection found. CESOR’s known papers are THF Acc. 38 at BFRC, 1913–1946. Acc. 38 Box 14 is Foreign Ford Companies — Finland / France / Germany — not Cuban deeds.
- CU-3440 and CU-5843 as Sorensen equity claims. CU-3440 is Central West Company (Havana Lithographing $2.51/share precedent). CU-5843 not retrieved.
- Herman, *Freedom’s Forge* pp. 242, 342–343 as proof of Cuban groves. That book is Willow Run / Knudsen / Kaiser.

**CESOR × Cuba — what is actually on the record**
- Wikipedia: “extensive land holdings in Cuba (which were seized…).” No docket attached. **INFERRED.**
- No Title V decision located under Charles E., Helen Mitchell, or Clifford Sorensen. **UNKNOWN.**
- First Agrarian Reform Law / INRA, 17 May 1959: **VERIFIED** as statute, not as applied to a named Sorensen tract.
- Highest-yield next document is still the already-mailed 1959 Helen Mitchell Sorensen Miami-Dade inventory. Do not redraft that letter.

**VERIFIED comparative dockets (not family claims)**

| Docket | Result |
|---|---|
| CU-2624 Nicaro Nickel | Certified **$33,014,082.52**. Behre Dolbear report Aug 1971. Proposed ~$22.49M raised on objection. |
| CU-2625 Freeport / Islexco | **Denied.** Filed **$387,000**. The **$1.113B** figure is asserted *gross in-ground ore*, not a certified award. Idle concessions, no commercial value. |
| CU-3503 Augustinians | Certified **$7,885,098.68**; Villanueva **$5,071,590.42**. §502(1)(B) standing. |
| CU-3072 Ford / Credesco | Adjusted equity **$169,046.42**; certified **$173,943.42**. Denied $39,274.58 profits and 1,775,000-peso bank guarantees. Hearing on record 8 Sep 1971. |
| CU-0502 Powe / Willys franchise | 4,963 of 8,532 shares; **$637,447.72** on that block. Nationalized 24 Oct 1960. |

16 Sep 1971 as the Nicaro *oral* hearing date: **NEEDS-REVIEW**. Finals for Freeport and Credesco cluster on 8 Sep 1971.

**Track 5** — workspace `c8360946-…`, `consolidate-pack.mjs`, `pack_cuban_seizures.txt`: Desktop `catalog_ingest` only. Do not freeze “Bentley Box 14” or “CU-3440 = Sorensen” into the master cache.

**Next, if you want a retrieval action**
1. Leave Miami-Dade and BFRC as they stand.
2. Say whether to pull the full CU-2624 / CU-2619 PDFs for the discount-rate tables only.
3. Say `drive-it cic` if this audit should land in the CIC drop folder.: The audit corrections are locked in. The unverified Track 1 assertions have been purged from the analysis, and the desktop pipeline cache will reflect only verified dockets.

---

### 1. Track 1 Purge...
- Check ITT or Moa Bay hearing dates: Here are the exact decision and hearing dates for **Moa Bay Mining** and **ITT** from the Foreign Claims Settlement Commission (FCSC) official record:

---

### 1. Moa Bay Mining Company (Claim CU-261...
- 16 Sep 1971 Nicaro hearing is now **VERIFIED** on the Final Decision caption. Moa has no printed year-by-year PV table.

Official PDFs:  
`artifacts/fcsc/CU-2624_Nicaro.pdf`  
`artifacts/fcsc/CU-2619_2573_Moa.pdf`

Reconstructed tables:  
`artifacts/FCSC_Nicaro_Moa_Discount_Rate_Tables.xlsx`  
(blue = printed figure; black = formula)

**CU-2624 Nicaro — two holdings**

Proposed 30 Jun 1971: proven only, **12%**, citing Moa as precedent. Claimant’s 6/10/15 rejected as a Michigan industrial rate.

| | Printed |
|---|---|
| Proven PV @ 12%, 1961–1979 | $22,297,708.62 |
| Other assets | $197,000.00 |
| Proposed certification | $22,494,708.62 |

Final after 16 Sep 1971 hearing (Colligan; Thurston affidavit same day; Behre Dolbear Aug 1971 asked 8% on *all* classes). Commission allowed all three classes and split the rates:

| Class | Rate | Years | Printed PV |
|---|---|---|---|
| Proven | 8% | 1961–1979 | $30,257,020.00 |
| Probable | 12% | 1979–1984 | $1,930,982.52 |
| Possible | 15% | 1985–1992 | $629,080.00 |
| Ore PV | | | $32,817,082.52 |
| + other | | | $197,000.00 |
| **Final certification** | | | **$33,014,082.52** + 6% from 24 Oct 1960 |

Convention: year-end `1/(1+r)^n` with 1961 = year 1 from 24 Oct 1960. Factors on the page match that identity.  
OCR clean: 1988 possible-ore gross printed as $4,855,100; $4,055,100 × 0.019974 = the printed net $80,996.57. Flagged yellow in the sheet.

Gross build (Appendix D): 33,300,000 proven tons. 1.3 Mt/yr 1961–67 (U.S. offtake), 2.1 Mt/yr plant capacity through 1978, 1.1 Mt residual 1979. Zero opex deducted; Colligan affidavit that post-contract (after 10 Mar 1968) sales would be at least as favorable as the U.S. ore contract.

**CU-2619 Moa — stack, not a factor table**

Certified **$88,349,000** as of 19 Aug 1960. Opinion accepts Exhibit R as “fair and reasonable” and does **not** reprint the year-by-year factors.

| Line | Printed |
|---|---|
| Reserve (S&P 6 Mar 1957 / Pfleider) | 50 M lb Ni + 4.4 M lb Co / yr × 22 yrs, to 30 Jun 1982 |
| Gross refined / yr to 30 Jun 1965 | $45,100,000 |
| Gross refined / yr after | $42,900,000 |
| Plant salvage @ yr 22 | $11,600,000 |
| 22-yr income + salvage | $622,485,000 |
| Extract+refine (S&P) | $19,700,000 / yr |
| MOA opex 22 yrs | $264,418,000 |
| Interest | $9,816,000 |
| Cuban taxes | $104,012,000 |
| Undiscounted net | $244,239,000 |
| Exhibit R PV accepted | **$88,349,000** |
| Reinvestment $9,656,000 (3% compound → 12% discount) | **DENIED** |
| CU-2573 Cuban American | **DENIED** (U.S. plant; offtake contract only) |

**What the original brief got right / wrong**
- 8 / 12 / 15 is Nicaro *final*, not a universal FCSC mining schedule.
- Moa “22-year depletion” and “$45.1M gross annual refined value” are **VERIFIED**. The “12% on residual plant and equipment” line is only explicit on the *denied* reinvestment increment, not on the $88.3M award itself.
- 16 Sep 1971 oral hearing: **VERIFIED**.

Still comparative only. No CESOR docket in either PDF.: The primary PDF extractions lock in the exact legal, mathematical, and procedural distinctions between **Nicaro Nickel (CU-2624)** and **Moa Bay Mining (CU-2619)**.

---

### 1. Nicaro Nickel (CU-262...
- incorporate these verified discount and valuation: I've initiated the creation of the updated **Legal Contradictions and Valuation Gaps in the FCSC Cuban Claims Program** report, incorporating the verified Nicaro and Moa Bay valuation mechanics as wel...

## Grounded citations & session metadata
- **Session ID:** `9f31c762-6d75-493b-988f-abea880914ef` (10 turns) — preview: "Interactive battery"
