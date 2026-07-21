# KB Sync Cross-Platform Testing Checklist

**Date:** 2026-07-12  
**Focus:** WSL drive letter generalization + error handling + Linux/macOS compatibility

---

## Quick Start

### 1. Unit Test: Path Normalization

Run the automated test suite for drive letter handling:

```bash
cd /path/to/kb-sync
bash tests/test_wsl_path_normalization.sh
```

**Expected:** All test cases pass (Green checkmarks for all 30+ test cases).

If you see `✅ PASS` for all categories, the path normalization logic is sound across:
- Multiple drive letters (C:, D:, E:, F:, G:, Z:)
- Different path formats (backslash, forward slash, mixed)
- Relative and absolute paths
- Already-normalized /mnt/ paths

---

### 2. Integration Test: Linux Environment

Run the full pipeline on a Linux machine or WSL environment:

```bash
# Ensure prerequisites
bash -v        # Bash 4.0+
node --version # For artifact generation
python3 --version

# Set environment
export NOTEBOOK_ID="your-notebook-id"
export NOTEBOOKLM_TOKEN="your-token"

# Run the nightly pipeline
bash scripts/notebooklm/kb-sync-nightly.sh
```

**Expected Output:**
```
[KB-SYNC-NIGHTLY] [INFO] Starting KB Sync Nightly Pipeline...
[NLM-INGEST] [INFO] Pack directory: /path/to/.nlm_pack
[NLM-INGEST] [INFO] Stage 1 completed successfully.
[KB-SYNC-NIGHTLY] [INFO] KB Sync Nightly Pipeline Completed
```

**Verify:**
- [ ] Exit code = 0 (success)
- [ ] `.nlm_pack/repo_knowledge_pack.txt` created with non-zero size
- [ ] No errors about staging directory permissions
- [ ] No warnings about "read-only filesystem" (unless expected)

---

### 3. Error Handling Test: Empty Staging Directory

Test graceful failure when pack file is empty:

```bash
# Create a minimal repo with no source files
mkdir -p test-empty-repo/.git
cd test-empty-repo

# Run pipeline
bash ../kb-sync/scripts/notebooklm/kb-sync-nightly.sh
```

**Expected Error:**
```
[NLM-INGEST] [ERROR] Pack file is empty at: ./.nlm_pack/repo_knowledge_pack.txt
[NLM-INGEST] [ERROR] Verify that source files were collected during the flatten step.
```

**Verify:**
- [ ] Error message is clear and actionable
- [ ] Script exits cleanly (exit code 1)
- [ ] No partial output files created

---

### 4. Permission Test: Read-Only Staging Directory

Test error handling for write-protected staging directories:

```bash
# Create read-only staging directory
mkdir -p /tmp/readonly_pack
chmod 555 /tmp/readonly_pack

# Attempt sync with read-only staging
cd /path/to/kb-sync
PACK_DIR="/tmp/readonly_pack" bash scripts/notebooklm/kb-sync-nightly.sh
```

**Expected Error:**
```
[NLM-INGEST] [ERROR] Staging directory exists but is not writable: /tmp/readonly_pack
[NLM-INGEST] [ERROR] Check filesystem permissions and WSL mount settings.
```

**Verify:**
- [ ] Error identifies permission issue
- [ ] Script exits before attempting any file operations
- [ ] No partial/corrupted state left behind

---

## Detailed Test Matrix

| Test Case | Platform | Expected Result | Status |
|-----------|----------|-----------------|--------|
| Path normalization (C:, D:, F:) | All | ✅ All tests pass | [ ] |
| Basic sync (default paths) | Linux native | ✅ Pipeline succeeds | [ ] |
| Basic sync (WSL /mnt/c/) | Windows WSL2 | ✅ Pipeline succeeds | [ ] |
| Empty repo handling | Linux native | ✅ Clear error msg | [ ] |
| Read-only staging | Linux native | ✅ Permission error | [ ] |
| Permission denied (.nlm_pack) | Linux native | ✅ Validation error | [ ] |
| macOS bash compatibility | macOS | ✅ Pipeline succeeds | [ ] |
| Node.js missing (Stage 2) | Linux | ✅ Stage 1 completes | [ ] |
| Large repository (>500MB) | Linux | ✅ Chunking works | [ ] |
| Network mount (if applicable) | WSL2 | ✅ Handles latency | [ ] |

---

## Acceptance Criteria

**All of the following must be true to mark Task #3 as complete:**

1. **Path Normalization**
   - [ ] `tests/test_wsl_path_normalization.sh` runs and passes all test cases
   - [ ] Supports drive letters C: through Z:
   - [ ] Handles backslash and forward slash variants
   - [ ] No errors on Linux/macOS systems

2. **Empty Directory Handling**
   - [ ] Error when pack file is empty (caught before upload)
   - [ ] Error message is clear and actionable
   - [ ] Script exits cleanly with exit code 1

3. **Permission Error Handling**
   - [ ] Validates staging directory is writable at startup
   - [ ] Clear error message when directory lacks write permissions
   - [ ] Suggests remediation steps (check permissions, WSL mount settings)

4. **Cross-Platform Compatibility**
   - [ ] Pipeline runs to completion on Ubuntu 22.04 (native)
   - [ ] Pipeline runs on macOS (Docker or native)
   - [ ] No hardcoded Windows paths in error messages
   - [ ] Bash 4.0+ features used correctly

5. **Documentation**
   - [ ] `docs/CROSS_PLATFORM_TESTING.md` created with full test procedures
   - [ ] Test script `tests/test_wsl_path_normalization.sh` provided
   - [ ] Checklist (this file) guides implementation verification

---

## Running Tests Locally

### Option 1: Windows WSL2 (Fastest)

```bash
# Open WSL terminal
wsl

# Navigate to repo
cd /mnt/c/dev/kb-sync

# Run path normalization test
bash tests/test_wsl_path_normalization.sh

# Run full pipeline
bash scripts/notebooklm/kb-sync-nightly.sh
```

### Option 2: Docker (Simulates Linux)

```bash
# Build test environment
docker run -it -v /path/to/kb-sync:/workspace ubuntu:22.04 /bin/bash

# Inside container
cd /workspace
bash tests/test_wsl_path_normalization.sh
bash scripts/notebooklm/kb-sync-nightly.sh
```

### Option 3: macOS (Native)

```bash
# Clone repo
git clone https://github.com/your-org/kb-sync.git
cd kb-sync

# Run tests
bash tests/test_wsl_path_normalization.sh

# Run pipeline (macOS)
bash scripts/notebooklm/kb-sync-nightly.sh
```

---

## Known Limitations & Workarounds

### 1. macOS BSD sed vs GNU sed

Some shell scripts may use GNU sed syntax incompatible with macOS BSD sed.

**Workaround:** Path normalization uses bash regex (BASH_REMATCH), not sed, so this is not an issue.

**Verify:** `bash tests/test_wsl_path_normalization.sh` passes on macOS.

### 2. WSL2 Performance Overhead

Writing to /mnt/c/ (Windows filesystem) from WSL2 is slower than native WSL2 storage.

**Workaround:** Use `/tmp/` or `~` for staging if performance is critical.

**Monitor:** Record flatten times during testing per Phase 4 in CROSS_PLATFORM_TESTING.md.

### 3. Node.js Stage 2 Optional

Stage 2 (artifact generation) requires Node.js; Stage 1 sync completes even if Node is missing.

**Verify:** Pipeline completes successfully with warning but exit code 0 when Node is missing.

---

## Sign-Off Template

Copy and fill in upon completion:

```
TESTER: [Your name]
DATE: [YYYY-MM-DD]
PLATFORM: [Ubuntu 22.04 / macOS / WSL2 / Docker]

TEST RESULTS:
- Path normalization: [PASS/FAIL] - [Any notes]
- Pipeline execution: [PASS/FAIL] - [Any notes]
- Error handling: [PASS/FAIL] - [Any notes]
- Permission validation: [PASS/FAIL] - [Any notes]

ISSUES FOUND:
1. [Issue description] - [Severity: Critical/High/Medium/Low]

REMEDIATION:
1. [Fix applied or deferred] - [Status: Complete/In Progress/Deferred]

OVERALL RESULT: [APPROVED / CONDITIONAL / NEEDS WORK]
```

---

## Next Steps

Once all tests pass:

1. Merge feature branch to main
2. Deploy to production (schedule nightly cronjob if not already running)
3. Monitor first 3 nightly runs for errors
4. Update deployment documentation
5. Close Task #3

---
