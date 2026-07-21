---
title: "CROSS PLATFORM TESTING"
category: "wiki"
status: "active"
---

# KB Sync Cross-Platform Testing Guide

**Updated:** 2026-07-12  
**Status:** Test plan for Linux/macOS WSL compatibility

---

## Overview

This document outlines testing procedures for KB Sync nightly report on non-Windows systems (Linux, macOS with WSL). The goal is to verify path handling, staging directory behavior, and core pipeline functionality across platforms.

---

## Test Environments

### Test Matrix

| Platform | Version | WSL Version | Path Format | Status |
|----------|---------|------------|-------------|--------|
| Windows 11 | Latest | WSL2 | `/mnt/c/...` | Reference |
| Ubuntu | 22.04 LTS | N/A (native) | `/home/...` | To test |
| macOS | Monterey+ | WSL emulation / Docker | `/Users/...` | To test |
| Debian | 12 | N/A (native) | `/home/...` | To test |

---

## Phase 1: Native Linux Testing (Ubuntu 22.04)

### Setup

```bash
# Clone kb-sync repo
git clone https://github.com/your-org/kb-sync.git
cd kb-sync

# Verify prerequisites
bash -v                    # Should be 4.0+
node --version            # For Stage 2 artifact generation
python3 --version         # If pipeline uses Python

# Set required env vars
export NOTEBOOK_ID="your-notebook-id"
export NOTEBOOKLM_TOKEN="your-token"  # or NOTEBOOKLM_COOKIE
```

### Test Case 1.1: Basic Path Resolution

**Objective:** Verify that relative and absolute paths resolve correctly on Linux.

```bash
cd /tmp/test-kb-sync
mkdir -p test-repo
cd test-repo

# Run with default relative paths
bash ./scripts/notebooklm/kb-sync-nightly.sh

# Expected: ./.nlm_pack directory created, flatten succeeds
# Verify: Check for repo_knowledge_pack.txt in .nlm_pack/
```

**Expected Output:**
```
[KB-SYNC-NIGHTLY] [INFO] Pack directory: /tmp/test-kb-sync/test-repo/.nlm_pack
[KB-SYNC-NIGHTLY] [INFO] Stage 1 completed successfully.
```

**Pass/Fail Criteria:**
- ✅ Pack directory created at correct path
- ✅ No "command not found" or permission errors
- ✅ Pack file has non-zero size

---

### Test Case 1.2: Staging Directory Permission Handling

**Objective:** Verify error handling when staging directory lacks write permissions.

```bash
# Create read-only staging directory
mkdir -p /tmp/readonly_pack
chmod 555 /tmp/readonly_pack

# Attempt to run with read-only staging dir
# Modify MODULE_CONFIG to point to /tmp/readonly_pack
export PACK_DIR="/tmp/readonly_pack"

bash ./scripts/notebooklm/kb-sync-nightly.sh

# Expected: Clear error message about write permissions
```

**Expected Error Output:**
```
[NLM-INGEST] [ERROR] Staging directory exists but is not writable: /tmp/readonly_pack
[NLM-INGEST] [ERROR] Check filesystem permissions and WSL mount settings.
```

**Pass/Fail Criteria:**
- ✅ Error message identifies the permission issue
- ✅ Script exits cleanly (exit code 1)
- ✅ No partial output or corrupted state

---

### Test Case 1.3: Empty Staging Directory Handling

**Objective:** Verify graceful failure when flatten produces no output.

**Procedure:**
1. Create a repo with only `.git/` and no source files
2. Run the pipeline
3. Verify error message about empty pack file

```bash
mkdir -p empty-repo/.git
cd empty-repo

bash ../../kb-sync/scripts/notebooklm/kb-sync-nightly.sh
```

**Expected Error Output:**
```
[NLM-INGEST] [ERROR] Pack file is empty at: ./.nlm_pack/repo_knowledge_pack.txt
[NLM-INGEST] [ERROR] Verify that source files were collected during the flatten step.
```

**Pass/Fail Criteria:**
- ✅ Error caught before upload step
- ✅ Clear diagnostic message
- ✅ No attempt to upload empty files

---

## Phase 2: macOS Testing

### Setup (macOS with Docker or similar)

```bash
# Requires Docker or native shell environment
# Recommended: Use Docker container for consistency

docker run -it ubuntu:22.04 /bin/bash
# Then follow Phase 1 setup within container
```

### Test Case 2.1: Bash Compatibility (macOS zsh)

**Objective:** Ensure scripts run under macOS default shell (zsh) or bash.

```bash
# Test on macOS
zsh -c 'bash ./scripts/notebooklm/kb-sync-nightly.sh'

# Verify shebang is respected
bash ./scripts/notebooklm/kb-sync-nightly.sh
```

**Expected:** Both invocations succeed without syntax errors.

---

### Test Case 2.2: Path Expansion (macOS specifics)

**Objective:** Verify tilde expansion and symlinks work correctly.

```bash
# Set PACK_DIR to home directory path
export PACK_DIR="~/kb-sync-pack"

bash ./scripts/notebooklm/kb-sync-nightly.sh

# Verify expansion happened: ls ~/kb-sync-pack/
```

**Pass/Fail Criteria:**
- ✅ Tilde (~) expanded to actual home directory
- ✅ Pack files created in correct location

---

## Phase 3: Regression Testing (All Platforms)

### Test Case 3.1: WSL Drive Letter Generalization

**Objective:** Verify that the new `normalize_wsl_path()` function correctly handles multiple drive letters.

**Test Inputs:**
```bash
# Test cases for normalize_wsl_path()
C:\Users\test\repo          → /mnt/c/Users/test/repo
D:\projects\kb-sync         → /mnt/d/projects/kb-sync
/F/staging                  → /mnt/f/staging
/mnt/d/pack                 → /mnt/d/pack (no change)
/home/user/pack             → /home/user/pack (no change)
F:/path/to/file             → /mnt/f/path/to/file
```

**Verification Script:**

```bash
#!/usr/bin/env bash
# Test normalize_wsl_path() function

source modules/notebooklm/ingest-notebooklm.sh 2>/dev/null

test_path() {
  local input="$1"
  local expected="$2"
  local result=$(normalize_wsl_path "$input")
  
  if [ "$result" = "$expected" ]; then
    echo "✅ PASS: $input → $result"
  else
    echo "❌ FAIL: $input"
    echo "   Expected: $expected"
    echo "   Got:      $result"
  fi
}

test_path "C:\Users\test\repo" "/mnt/c/Users/test/repo"
test_path "D:\projects\kb-sync" "/mnt/d/projects/kb-sync"
test_path "F:/staging" "/mnt/f/staging"
test_path "/mnt/d/pack" "/mnt/d/pack"
test_path "/home/user/pack" "/home/user/pack"
```

**Run:**
```bash
bash test_path_normalization.sh
```

**Expected:** All test cases pass (✅ PASS for each).

---

### Test Case 3.2: Error Message Clarity (Cross-Platform)

**Objective:** Verify that error messages are platform-agnostic and actionable.

**Test Scenarios:**
1. Missing NOTEBOOK_ID
2. Unreachable staging directory
3. Insufficient disk space
4. Invalid credentials

**For Each Scenario:**
- Run pipeline
- Capture stderr output
- Verify error message does not reference Windows-specific paths
- Verify remediation steps are clear

---

## Phase 4: Performance Baselines

### Benchmark: Time to Flatten

**Objective:** Establish baseline flatten times across platforms.

```bash
# Measure flatten time on each platform
time bash ./core/flatten.sh \
  --output "./test_pack" \
  --pack-name "benchmark.txt" \
  --global-config "./configs/global.yaml" \
  --repo-root "."
```

**Record Results:**
| Platform | Repo Size | Flatten Time | Notes |
|----------|-----------|--------------|-------|
| Ubuntu 22.04 | 1GB | TBD | Native filesystem |
| macOS | 1GB | TBD | SSD dependent |
| Windows WSL2 | 1GB | TBD | Cross-filesystem overhead |

---

## Test Execution Checklist

### Before Running Tests

- [ ] Clone fresh kb-sync repo
- [ ] Verify all prerequisites installed (bash 4.0+, node, python3)
- [ ] Create `.env` with valid NOTEBOOKLM credentials
- [ ] Allocate 2GB+ disk space for staging

### During Tests

- [ ] Capture stdout/stderr to log file
- [ ] Monitor disk space usage
- [ ] Record any warnings or non-fatal errors
- [ ] Take screenshots of final state

### After Tests

- [ ] Verify no orphaned processes
- [ ] Check for stale staging directories
- [ ] Document any platform-specific workarounds
- [ ] Clean up test artifacts

---

## Known Issues & Workarounds

### Issue 1: macOS sed Compatibility

**Problem:** GNU sed vs BSD sed have different syntax for `-i` (in-place edit).

**Workaround:** Use `sed -i ''` on macOS (with empty string argument).

**Status:** Verify in path normalization function regex (lines use BASH_REMATCH, not sed).

---

### Issue 2: WSL2 Cross-Filesystem Performance

**Problem:** Writing from Windows to WSL mounting point can be slow.

**Workaround:** Measure performance baseline and document expected times per platform.

**Status:** Captured in Phase 4 benchmarks.

---

### Issue 3: Node.js Availability (Stage 2)

**Problem:** Stage 2 artifact generation requires Node.js; graceful degradation if missing.

**Current Behavior:** Script logs warning and continues.

**Verify:** Stage 2 skips cleanly without failing Stage 1.

---

## Success Criteria

All of the following must be true:

- ✅ Pipeline runs to completion on Ubuntu 22.04 (native Linux)
- ✅ Pipeline runs to completion on macOS (Docker or native)
- ✅ Path normalization handles C:, D:, F: drive letters correctly
- ✅ Error messages are clear and platform-agnostic
- ✅ Empty staging directory errors prevent uploads
- ✅ Permission errors provide actionable remediation steps
- ✅ No platform-specific file paths leak into user-facing output

---

## Sign-Off

**Testing Lead:** [TBD]  
**Date Completed:** [TBD]  
**Platforms Tested:** [TBD]  
**Issues Found:** [TBD]  
**Remediation:** [TBD]  

---
