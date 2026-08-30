#!/usr/bin/env bash
set -euo pipefail

# Configuration
DIRECTIVE_DIR="_kb-sync-staging/trm/directives"
DIRECTIVE_FILE="${DIRECTIVE_DIR}/GAP-03_cuba_seizure_directive.json"
STAGING_DIR="_kb-sync-staging/trm/cast-iron-charlie/GAP-03"
LOG_DIR="_kb-sync-staging/trm/logs"
TIMESTAMP=$(date +%Y%m%d_%H%M%S 2>/dev/null || date +%s)
LOG_FILE="${LOG_DIR}/GAP-03_research_${TIMESTAMP}.log"

# Create required directory structure
mkdir -p "${DIRECTIVE_DIR}"
mkdir -p "${STAGING_DIR}"
mkdir -p "${LOG_DIR}"

echo "=== TRM Stage 3 Deep Research Trigger: GAP-03 ==="
echo "Directive: ${DIRECTIVE_FILE}"
echo "Staging:   ${STAGING_DIR}"
echo "Log:       ${LOG_FILE}"

# Verify directive existence
if [[ ! -f "${DIRECTIVE_FILE}" ]]; then
  echo "[-] Error: Directive file not found at ${DIRECTIVE_FILE}"
  exit 1
fi

# Execute research worker if present, otherwise log directive readiness
echo "[+] Dispatching TRM research worker..."
if [[ -f "modules/trm/trm-worker.mjs" ]]; then
  node modules/trm/trm-worker.mjs --directive "${DIRECTIVE_FILE}" --output-dir "${STAGING_DIR}" 2>&1 | tee "${LOG_FILE}"
elif [[ -f "modules/trm/gap-triage-engine.mjs" ]]; then
  echo "[+] TRM gap-triage-engine found. Running gap triage processing..."
  node modules/trm/gap-triage-engine.mjs --directive "${DIRECTIVE_FILE}" 2>&1 | tee "${LOG_FILE}" || true
else
  echo "[*] Directive staged and ready for scheduler dispatch at ${DIRECTIVE_FILE}" | tee "${LOG_FILE}"
fi

# Execute downstream resolution and autohealing if modules exist
if [[ -f "modules/wiki/trm-source-resolver.mjs" ]]; then
  echo "[+] Triggering source resolution..."
  node modules/wiki/trm-source-resolver.mjs --input-dir "${STAGING_DIR}" || true
fi

if [[ -f "modules/wiki/autoheal-sweeper.mjs" ]]; then
  echo "[+] Running autoheal sweeper..."
  node modules/wiki/autoheal-sweeper.mjs --target "wiki/research/rfc-gap-03--cast-iron-charlie-research-lo.md" || true
fi

if [[ -f "modules/wiki/validate-trm-semantics.mjs" ]]; then
  echo "[+] Validating TRM semantics..."
  node modules/wiki/validate-trm-semantics.mjs || true
fi

echo "[+] Research pipeline execution completed."
