import { normalizeRepoPath, matchGlobPattern } from './path-utils.mjs';
import { isOutlineAllowedFile } from './outliner.mjs';

const JS_TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function isJsTsFile(filePath) {
  const ext = filePath.slice(((filePath.lastIndexOf(".") - 1) >>> 0) + 2).toLowerCase();
  return JS_TS_EXTENSIONS.has('.' + ext);
}

function matchesPrefixBoundary(filePath, prefix) {
  if (filePath === prefix) return true;
  if (filePath.startsWith(prefix.endsWith('/') ? prefix : prefix + '/')) return true;
  return false;
}

export function classifyFile({ repoRoot, rawPath, config, overridesResult, dirtyFilesSet, recentFilesSet, skipPatterns }) {
  const relativePath = normalizeRepoPath(rawPath, repoRoot);

  // 1. Excluded Skip Patterns Check
  for (const pattern of skipPatterns || []) {
    if (matchGlobPattern(relativePath, pattern)) {
      return { state: 'Excluded', reason: `Matched exclusion pattern (${pattern})` };
    }
  }

  // 2. Global Compaction Disabled Check
  if (!config.compaction.enabled) {
    return { state: 'Full', reason: 'Global compaction disabled (compaction.enabled = false)' };
  }

  // 3. Fail-Closed Overrides Error Check
  if (overridesResult.error) {
    return { state: 'Full', reason: `Fail-closed: Overrides error (${overridesResult.error})` };
  }

  // 4. Fail-Closed Git Inspection Check
  if (dirtyFilesSet === null || recentFilesSet === null) {
    return { state: 'Full', reason: 'Fail-closed: Git status or log inspection failed' };
  }

  // 5. Local Dirty / Untracked / Staged Check
  if (dirtyFilesSet.has(relativePath)) {
    return { state: 'Full', reason: 'Uncommitted local modifications (Git dirty state)' };
  }

  // 6. Active Transient Local Override Check
  if (overridesResult.map.has(relativePath)) {
    return { state: 'Full', reason: 'Active local override in .compaction-overrides.yaml' };
  }

  // 7. High-Risk Path Check
  for (const prefix of config.compaction.high_risk_prefixes || []) {
    if (matchesPrefixBoundary(relativePath, prefix)) {
      return { state: 'Full', reason: `High-risk path match (${prefix})` };
    }
  }

  // 8. Bulk Git Recency Check
  if (recentFilesSet.has(relativePath)) {
    return { state: 'Full', reason: `Modified within recent ${config.compaction.git_window_days}-day Git window` };
  }

  // 9. Explicit Configured Rule Match (First match wins)
  for (const rule of config.compaction.rules || []) {
    if (matchesPrefixBoundary(relativePath, rule.prefix)) {
      if (rule.level === 'Skeleton') {
        if (isJsTsFile(relativePath)) {
          return { state: 'Skeleton', reason: `Clean stable file matching Skeleton rule (${rule.prefix})` };
        }
        return { state: 'Full', reason: `Skeleton rule matched but unsupported file extension` };
      }
      if (rule.level === 'Outline') {
        if (isOutlineAllowedFile(relativePath)) {
          return { state: 'Outline', reason: `Clean stable file matching Outline rule (${rule.prefix})` };
        }
        return { state: 'Full', reason: `Outline rule matched but file type not in Outline allowlist` };
      }
      if (rule.level === 'Full') {
        return { state: 'Full', reason: `Configured Full rule match (${rule.prefix})` };
      }
    }
  }

  // 10. Default Policy Fallback
  return { state: config.compaction.default_level, reason: `Default policy fallback (${config.compaction.default_level})` };
}
