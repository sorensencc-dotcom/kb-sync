# NotebookLM Pack-Count Check (`nlm-pack-count-check.mjs`)

## Purpose

Verifies the NotebookLM thematic knowledge pack invariant across all active swept notebooks in `state/knowledge-plane-notebooks.json`:

- At most **one** logical pack family per notebook (contiguous multipart series such as `repo_knowledge_pack_part_aa`..`_part_ap` or `pack_master_kb_part_aa`.. count as one family).
- No `.bak.txt` backup files uploaded as sources.
- No pack sources in error (`3` / `ERROR` / `FAILED`) or missing status.
- No gaps in multipart sequences (`aa`, `ab`, `ac`, ...).
- No pack pollution in `has_pack: false` notebooks or software packs in historical notebooks.

The script uses only the local `nlm` CLI (`nlm source list <notebook-id> --json`) with no AI calls and writes an atomic status JSON file for downstream watchers.

## Usage

```bash
node scripts/nlm-pack-count-check.mjs [--manifest <path>] [--out <path>]
```

Or via npm:

```bash
npm run nlm:pack-count
```

### Flags & Environment Variables

| Option / Variable | Default | Description |
| --- | --- | --- |
| `--manifest <path>` | `state/knowledge-plane-notebooks.json` | Path to the notebook manifest JSON file. |
| `--out <path>` | `_status-feed/nlm_pack_counts.json` | Output status file path (overrides `NLM_PACK_COUNT_OUT`). |
| `NLM_PACK_COUNT_OUT` | `_status-feed/nlm_pack_counts.json` | Environment variable for the output JSON path when `--out` is not passed. |
| `--help` | - | Print usage summary and exit `0`. |

## Finding Codes

| Code | Severity | Condition |
| --- | --- | --- |
| `MULTI_FAMILY` | `red` | More than one distinct pack family key in a notebook, or duplicate exact pack/part titles. |
| `BAK_UPLOADED` | `red` | Any source title ending in `.bak.txt` (case-insensitive). |
| `PACK_ERROR_STATUS` | `red` | Any pack source with status `3`, `"3"`, `ERROR`, `FAILED`, `STATUS_ERROR`, `STATUS_FAILED`, or missing/`null`/`undefined`. |
| `MULTIPART_GAP` | `red` | Multipart pack family labels do not form a contiguous two-letter sequence starting at `aa` (`aa`, `ab`, `ac`, ...). |
| `POLLUTION` | `red` | Pack source present in a `has_pack: false` notebook, or software pack present in a historical domain notebook. |
| `NO_PACK` | `info` | Notebook has `has_pack: true` in the manifest but currently has zero pack sources (does not turn overall status `RED`). |

## Output JSON Shape

```json
{
  "generated_at": "2026-10-17T12:00:00.000Z",
  "overall": "GREEN",
  "notebooks_checked": 30,
  "notebooks_unknown": 0,
  "counts": {
    "willow-run": {
      "notebook_id": "6fd7c40b-df90-444b-9c7a-a64682925856",
      "families": 1,
      "sources": 12,
      "pack_sources": 1,
      "parts": 0
    }
  },
  "findings": [],
  "unknown": []
}
```

## Exit Codes

| Exit Code | Overall Status | Meaning |
| --- | --- | --- |
| `0` | `GREEN` | All checked notebooks satisfy invariants and zero `unknown` runner errors occurred. |
| `2` | `RED` | One or more `red` severity findings were detected. |
| `3` | `UNKNOWN` | Runner failed with `AUTH` (authentication expired/required), `CLI_MISSING`, or generic `ERROR` (retried once) with no `red` findings. An expired authentication result is always `UNKNOWN` (`3`), never `RED`. |

## Suggested Schedule

Run this check after pack writers finish:

- **After 3:45 AM ET** (following `1:30 AM` `CIC-Nightly-Notebook-Mining` and `3:30 AM` `CIC-TRM-ClosedLoop-Nightly-Miner`).
- **After 8:45 PM ET** (following `8:00 PM` `KB-Sync-Master-Pipeline`).

> **Note:** This script only performs the check and writes the status JSON file. It does **not** create, modify, or register any Windows Scheduled Task; registering a scheduled task is a separate operational step.
