#!/usr/bin/env bash
# ==============================================================================
# WSL Path Normalization Test Suite
# Tests the normalize_wsl_path() function across drive letters and formats
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
PASS_COUNT=0
FAIL_COUNT=0

# Source the ingest script to get normalize_wsl_path()
# Extract just the function definition for testing
extract_normalize_function() {
  sed -n '/^normalize_wsl_path() {/,/^}/p' "$REPO_ROOT/modules/notebooklm/ingest-notebooklm.sh"
}

# Evaluate the function in this shell
eval "$(extract_normalize_function)"

# Test harness
test_path_normalization() {
  local input="$1"
  local expected="$2"
  local description="$3"

  local result
  result=$(normalize_wsl_path "$input")

  if [ "$result" = "$expected" ]; then
    printf "${GREEN}✅ PASS${NC} %s\n" "$description"
    printf "   Input:    %s\n" "$input"
    printf "   Expected: %s\n" "$expected"
    printf "   Got:      %s\n" "$result"
    ((PASS_COUNT++))
  else
    printf "${RED}❌ FAIL${NC} %s\n" "$description"
    printf "   Input:    %s\n" "$input"
    printf "   Expected: %s\n" "$expected"
    printf "   Got:      %s\n" "$result"
    ((FAIL_COUNT++))
  fi
  printf "\n"
}

# Test Category 1: Windows paths with C: drive (baseline)
echo "========================================================================"
echo "Category 1: Windows C: drive paths (baseline)"
echo "========================================================================"
test_path_normalization "C:\Users\test\repo" "/mnt/c/Users/test/repo" "Windows C: absolute path"
test_path_normalization "C:/Users/test/repo" "/mnt/c/Users/test/repo" "Windows C: with forward slashes"
test_path_normalization "C:" "/mnt/c:" "C: drive letter only (edge case)"

# Test Category 2: Other drive letters (D:, E:, F:, etc.)
echo "========================================================================"
echo "Category 2: Multi-drive letter support (D:, E:, F:, G:)"
echo "========================================================================"
test_path_normalization "D:\projects\kb-sync" "/mnt/d/projects/kb-sync" "Windows D: drive"
test_path_normalization "E:\data\staging" "/mnt/e/data/staging" "Windows E: drive"
test_path_normalization "F:\backups\archive" "/mnt/f/backups/archive" "Windows F: drive"
test_path_normalization "G:\external\usb" "/mnt/g/external/usb" "Windows G: drive"
test_path_normalization "Z:\network\share" "/mnt/z/network/share" "Windows Z: network drive"

# Test Category 3: Leading slash variants
echo "========================================================================"
echo "Category 3: Slash-prefixed Windows paths (/D/, /E/, etc.)"
echo "========================================================================"
test_path_normalization "/C/Users/test" "/mnt/c/Users/test" "Slash-prefixed C:"
test_path_normalization "/D/projects" "/mnt/d/projects" "Slash-prefixed D:"
test_path_normalization "/F/staging" "/mnt/f/staging" "Slash-prefixed F:"

# Test Category 4: Already-normalized /mnt/ paths (should pass through)
echo "========================================================================"
echo "Category 4: Already-normalized /mnt/ paths (pass-through)"
echo "========================================================================"
test_path_normalization "/mnt/c/Users/test" "/mnt/c/Users/test" "/mnt/c pass-through"
test_path_normalization "/mnt/d/projects" "/mnt/d/projects" "/mnt/d pass-through"
test_path_normalization "/mnt/z/share" "/mnt/z/share" "/mnt/z pass-through"

# Test Category 5: Unix-style absolute paths (should pass through)
echo "========================================================================"
echo "Category 5: Unix-style absolute paths (pass-through)"
echo "========================================================================"
test_path_normalization "/home/user/repo" "/home/user/repo" "Unix /home/ absolute"
test_path_normalization "/opt/staging" "/opt/staging" "Unix /opt/ absolute"
test_path_normalization "/tmp/test" "/tmp/test" "Unix /tmp/ absolute"
test_path_normalization "/var/lib/data" "/var/lib/data" "Unix /var/lib/ absolute"

# Test Category 6: Relative paths (should pass through)
echo "========================================================================"
echo "Category 6: Relative paths (pass-through)"
echo "========================================================================"
test_path_normalization "./.nlm_pack" "./.nlm_pack" "Relative current dir"
test_path_normalization "./staging/output" "./staging/output" "Relative nested"
test_path_normalization "../sibling/dir" "../sibling/dir" "Relative parent"

# Test Category 7: Edge cases & mixed separators
echo "========================================================================"
echo "Category 7: Edge cases and mixed separators"
echo "========================================================================"
test_path_normalization "D:\path\to/mixed\\separators" "/mnt/d/path/to/mixed/separators" "Mixed separators"
test_path_normalization "F:/staging//double///slash" "/mnt/f/staging//double///slash" "Multiple slashes preserved"

# Test Category 8: Case sensitivity (drive letters should be lowercase)
echo "========================================================================"
echo "Category 8: Case sensitivity (drive letters)"
echo "========================================================================"
test_path_normalization "C:\Users" "/mnt/c/Users" "Lowercase c drive"
test_path_normalization "D:\Projects" "/mnt/d/Projects" "Lowercase d drive"

# Summary
echo "========================================================================"
echo "Test Summary"
echo "========================================================================"
printf "${GREEN}Passed: %d${NC}\n" "$PASS_COUNT"
printf "${RED}Failed: %d${NC}\n" "$FAIL_COUNT"
TOTAL=$((PASS_COUNT + FAIL_COUNT))
printf "Total:  %d\n" "$TOTAL"

if [ $FAIL_COUNT -eq 0 ]; then
  printf "\n${GREEN}All tests passed!${NC}\n"
  exit 0
else
  printf "\n${RED}Some tests failed. Review output above.${NC}\n"
  exit 1
fi
