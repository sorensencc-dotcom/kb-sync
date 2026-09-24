---
source: grok
skill: drive-it
topic: cic
title: "THF Sorensen Catalog Audit"
created: Tue Sep 22 2026 22:26:18 GMT-0400 (Eastern Daylight Time)
folder_id: 1Faya0q0j3S62NGq_U-nxrefwbwfGQq0g
status: drop
provenance_type: mobile_inbox_drop
content_sha256: 682580fde33c4a53f0da5825d142ec676e6a85067aa1bcdbb9cc49a66a61189b
---

# THF Sorensen Catalog Audit

## Context

Chris dropped a research brief styled as the “Henry Ford Sorensen Catalog” (claimed official THF / BFRC index: 76 cataloged records, 213 reference photographs spanning CESOR’s Ford career). Grok audited the brief against public THF digital-collection object cards and BFRC finding aids / AskUs bibliographies. Goal: keep usable Willow Run and foreign-plant anchors, kill ID-scheme conflation before it enters the Kroll log or the unsent BFRC packet.

Track status unchanged: Miami-Dade probate letter already mailed. BFRC Acc. 38 / Acc. 65:66–69 / Acc. SE007 packet drafted, not sent.

## Payload

### User ask
- Source brief covering dual production command, 1 p.m. Engineering Lab lunches, Fordlandia hardwood, aborted Shanghai plant, 1914 Safety Committee, Willow Run object IDs, ledger caption errors (Kanglet / Henni / M Wedge), unexplained “GPD Inc” on a Lindbergh 1942 caption, and the 1943 Sorensen–Edsel–Bricker power shift.
- Close: inspect a specific catalog object, or explore 1943 executive dynamics.
- Follow-up command: `drive-it cic`.

### Decisions
- Do not treat “Henry Ford Sorensen Catalog / 76 records / 213 photographs” as a published THF finding-aid title. Count is UNKNOWN until the internal index file is cited.
- Do not redraft or send the BFRC letter from this thread.
- Do not put Kanglet, GPD Inc, Helms-Burton, or probate into any BFRC email.
- Next research priority is paper, not more object cards: Acc. 65:66–69, Acc. 38 box 106, Acc. 435 La Croix Willow Run volumes. Optional photo forensics: negative sequence 78778 (full) and 76901 (alleged Kanglet / Olav).

### ID scheme (keep)
- Acc. 38 = Charles E. Sorensen Office Files and Personal Records (manuscripts).
- Acc. 65 = Owen W. Bombard interviews.
- Acc. 689 = W.C. Cowling Records (Shanghai scrapbook).
- Acc. 435 = Charles C. La Croix Records (Willow Run operational volumes + FDR tour print).
- 64.167 = 1964 Ford Motor Company gift prefix on digital Object IDs.
- “Series 64.167.38” is an error. Do not use.

### VERIFIED anchors
- Scale-model Willow Run photo: Object 64.167.833.P.75904, July 1941 (month-only on public card; “July 1” is INFERRED). https://www.thehenryford.org/collections-and-research/digital-collections/artifact/359145/
- FDR / Eleanor / Henry / Edsel / Sorensen Sunshine Special tour: Object 64.167.435.P.833.77104.9, 18 Sep 1942, La Croix collection. https://www.thehenryford.org/collections-and-research/digital-collections/artifact/62490
- Cowling Shanghai scrapbook: Acc. 689 / Object 64.167.689.1, 1930–1932. THF caption: project dropped when Chinese law required native citizenship for land ownership. “17-page” UNKNOWN. https://www.thehenryford.org/collections-and-research/digital-collections/artifact/371829
- Acc. 38 China/Shanghai paper: boxes 2 (1930), 4 (1931), 8 (1932); later boxes 26 / 36 / 39.
- Acc. 38 Willow Run paper on AskUs bib: box 89 Government Work / Bomber Plant; box 106 Willow Run Bomber Plant.
- Sikorsky VS-300 day is real (7 Oct 1943). Public frames: 84.1.1660.P.833.78778.2 (landing) and 84.1.1660.P.B.2306 (HF II, Lindbergh, Les Morris, Henry Ford, Sikorsky). Sorensen-filming frame .13 not on public titles.

### Mismatches / UNKNOWN
- Groundbreaking 17 Sep 1940 Object 64.167.833.P.74367.A: public card not found. THF Willow Run site caption says construction began March 1941.
- Material Control Flow Chart cited as 64.167.38.7 / 1 Apr 1944 / 11 major + 69 subassemblies. Public object is 64.167.435.3, subject date 1 Sep 1944, La Croix. Public summary does not state 11/69.
- Lindbergh Object 84.1.1660.P.833.76926 + caption “GPD Inc”: public card not found. 1954 Ferndale GPD, Inc. (Ford genuine-parts distributor) is a false friend.
- Ledger ghosts Kanglet / Henni / M Wedge / frame 76901 Churchill vs Crown Prince Olav: not confirmed on public THF this pass.
- Dual command without titles: INFERRED from Acc. 38 structure + secondary literature; photograph catalog does not prove it.
- 1:00 p.m. Engineering Lab lunch roster (Ford, Edsel, Sorensen, Martin, Craig, Wibel, Dahlinger): UNKNOWN as a catalog fact.
- Fordlandia hardwood-export offset from Sorensen’s office: INFERRED, needs folder cite.
- 1914 Safety Committee hygiene program: UNKNOWN this pass.
- 1943 Bricker operational takeover / March 1944 exit: photographs cannot close it.

### Artifact paths (project folder)
- artifacts/BFRC_Request_Acc38_Acc65_SE007_Sorensen.docx — Track 4 packet, not sent.
- artifacts/Miami-Dade_Probate_Request_Helen_Mitchell_Sorensen_1959.docx — Track 2 draft; mailed version already sent. Do not redraft.

### Optional BFRC Day-1 add-on (only if letter is revised later; stay inside 15-box cap)
1. Acc. 38 boxes 2, 4, 8 — Shanghai / Cowling.
2. Acc. 38 boxes 89 and 106 — bomber plant.
3. Acc. 689 — Cowling scrapbook (one volume).
4. Acc. 435 — La Croix Willow Run vols. 13–16 (ask staff for box numbers).

## Next

Desktop catalog_ingest / morning pipeline picks this up. Do not run catalog_ingest from Grok.
