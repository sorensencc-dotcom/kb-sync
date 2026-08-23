---
source_title: "Historical Revocation Verification & Key Epoch Lifecycle"
repository: "Sigil Trust Engine Protocols - Accession 42, Box 12"
document_date: "2026-08-23"
verification_status: "verified"
category: "ford-politics"
topic: historical-revocation-verification
status: active
last_updated: 2026-08-23T02:19:45.926Z
---
# Historical Revocation Verification

When verifying historical signatures:
- A signature generated *before* the key's revocation timestamp remains cryptographically valid under the **Sigil Trust Engine**.
- Local connectors must cache revoked keys with their active revocation intervals inside the **Local SQLite database** to check transaction histories offline.
