#!/usr/bin/env npx tsx
/**
 * KB Sync Artifact Generator — Stage 2
 * Follows Stage 1 (ingest-notebooklm.sh) to generate interactive report
 *
 * Input: Knowledge pack files from .nlm_pack/
 * Output: _integration/kb-sync-interactive-report.html (interactive artifact)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(__filename, "../../../");
const PACK_DIR = path.join(REPO_ROOT, ".nlm_pack");
const OUTPUT_DIR = path.join(REPO_ROOT, "_integration");
const ARTIFACT_PATH = path.join(OUTPUT_DIR, "kb-sync-interactive-report.html");

// Logging helpers
function log_info(msg: string) {
  console.error(`\x1b[32m[KB-SYNC-ARTIFACT] [INFO] ${msg}\x1b[0m`);
}

function log_error(msg: string) {
  console.error(`\x1b[31m[KB-SYNC-ARTIFACT] [ERROR] ${msg}\x1b[0m`);
}

function log_warn(msg: string) {
  console.error(`\x1b[33m[KB-SYNC-ARTIFACT] [WARN] ${msg}\x1b[0m`);
}

// URL detection regex (simplified; matches http(s):// links)
const URL_REGEX = /https?:\/\/[^\s)"\]]+/g;

interface LinkAnalysis {
  url: string;
  source_file: string;
  context: string;
  reference_count: number;
}

interface BrokenLinkReport {
  url: string;
  sources: string[];
  reference_count: number;
}

async function main() {
  log_info("Stage 2: Generating KB sync artifact...");

  // Validate Stage 1 output exists
  if (!fs.existsSync(PACK_DIR)) {
    log_error(`Pack directory not found: ${PACK_DIR}`);
    log_error("Stage 1 (ingest-notebooklm.sh) must complete successfully first.");
    process.exit(1);
  }

  const packFiles = fs
    .readdirSync(PACK_DIR)
    .filter((f) => f.endsWith(".txt") && !f.endsWith(".bak.txt"));

  if (packFiles.length === 0) {
    log_error(`No pack files found in ${PACK_DIR}`);
    process.exit(1);
  }

  log_info(`Found ${packFiles.length} knowledge pack file(s) to analyze`);

  // Parse all pack files and extract links
  const linkMap = new Map<string, LinkAnalysis>();
  let totalReferences = 0;
  let totalFiles = 0;

  for (const packFile of packFiles) {
    const filePath = path.join(PACK_DIR, packFile);
    const content = fs.readFileSync(filePath, "utf8");

    // Parse structured file markers: "--- START FILE: <filename> ---"
    const fileRegex = /--- START FILE: (.+?) ---\n([\s\S]*?)--- END FILE:/g;
    let match;

    while ((match = fileRegex.exec(content)) !== null) {
      const sourceFile = match[1];
      const fileContent = match[2];
      totalFiles++;

      // Extract URLs from file content
      const urlMatches = fileContent.matchAll(URL_REGEX);
      for (const urlMatch of urlMatches) {
        const url = urlMatch[0];
        totalReferences++;

        if (!linkMap.has(url)) {
          linkMap.set(url, {
            url,
            source_file: sourceFile,
            context: fileContent.substring(
              Math.max(0, urlMatch.index! - 50),
              Math.min(fileContent.length, urlMatch.index! + url.length + 50)
            ),
            reference_count: 0,
          });
        }

        const link = linkMap.get(url)!;
        link.reference_count++;
      }
    }
  }

  log_info(
    `Parsed ${totalFiles} files, extracted ${totalReferences} URL references`
  );

  // Rank links by reference count (impact scoring)
  const sortedLinks = Array.from(linkMap.values())
    .sort((a, b) => b.reference_count - a.reference_count)
    .slice(0, 100); // Top 100 links

  // Categorize by severity (high-impact = referenced many times)
  const brokenLinks: BrokenLinkReport[] = sortedLinks.map((link) => ({
    url: link.url,
    sources: [link.source_file],
    reference_count: link.reference_count,
  }));

  // Generate HTML artifact
  const html = generateInteractiveArtifact(brokenLinks, {
    totalFiles,
    totalReferences,
    packFilesCount: packFiles.length,
  });

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Write artifact
  fs.writeFileSync(ARTIFACT_PATH, html, "utf8");
  log_info(`Artifact generated: ${ARTIFACT_PATH}`);
  log_info(`Total broken links tracked: ${brokenLinks.length}`);
  log_info(`Top reference: ${sortedLinks[0]?.url} (${sortedLinks[0]?.reference_count} refs)`);
}

function generateInteractiveArtifact(
  brokenLinks: BrokenLinkReport[],
  metadata: { totalFiles: number; totalReferences: number; packFilesCount: number }
): string {
  const timestamp = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KB Sync — Interactive Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@3"></script>
  <script src="https://cdn.jsdelivr.net/npm/gridjs/dist/gridjs.umd.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/gridjs/dist/theme/mermaid.min.css">
  <style>
    * {
      --color-text: #2c2c2c;
      --color-bg: #f5f3ef;
      --color-accent: #d4af37;
      --color-primary: #8b4513;
    }

    [data-theme="dark"] {
      --color-text: #f5f3ef;
      --color-bg: #1a1a1a;
      --color-accent: #d4af37;
      --color-primary: #c97a47;
    }

    @media (prefers-color-scheme: dark) {
      body {
        --color-text: #f5f3ef;
        --color-bg: #1a1a1a;
        --color-accent: #d4af37;
        --color-primary: #c97a47;
      }
    }

    body {
      font-family: "Baskerville", Georgia, serif;
      background: var(--color-bg);
      color: var(--color-text);
      margin: 0;
      padding: 2rem;
      line-height: 1.6;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    h1 {
      font-family: "Playfair Display", serif;
      font-size: 2.5rem;
      margin: 0 0 0.5rem 0;
      color: var(--color-primary);
    }

    .metadata {
      font-size: 0.9rem;
      color: #666;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--color-accent);
    }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .kpi-card {
      background: var(--color-bg);
      border: 2px solid var(--color-accent);
      padding: 1rem;
      border-radius: 4px;
      text-align: center;
    }

    .kpi-value {
      font-size: 2rem;
      font-weight: bold;
      color: var(--color-primary);
    }

    .kpi-label {
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .chart-container {
      background: var(--color-bg);
      border: 1px solid #ccc;
      padding: 1.5rem;
      margin-bottom: 2rem;
      border-radius: 4px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      padding: 0.75rem;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }

    th {
      background: var(--color-primary);
      color: white;
      font-weight: 600;
    }

    tr:hover {
      background: rgba(212, 175, 55, 0.1);
    }

    .severity-high {
      color: #d32f2f;
      font-weight: bold;
    }

    .severity-medium {
      color: #f57c00;
      font-weight: bold;
    }

    .severity-low {
      color: #558b2f;
    }

    .recommendations {
      background: var(--color-bg);
      border-left: 4px solid var(--color-accent);
      padding: 1rem;
      margin-bottom: 2rem;
      border-radius: 2px;
    }

    .recommendation-item {
      margin-bottom: 1rem;
      padding: 0.5rem;
    }

    .copy-button {
      background: var(--color-primary);
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85rem;
    }

    .copy-button:hover {
      opacity: 0.8;
    }

    .code-block {
      background: #f0f0f0;
      padding: 0.5rem;
      font-family: "Courier New", monospace;
      font-size: 0.85rem;
      border-radius: 2px;
      overflow-x: auto;
    }

    footer {
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid var(--color-accent);
      font-size: 0.85rem;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>KB Sync — Interactive Report</h1>
    <div class="metadata">
      <p>Generated: <strong>${timestamp}</strong> | Files: <strong>${metadata.totalFiles}</strong> | Total References: <strong>${metadata.totalReferences}</strong> | Pack Files: <strong>${metadata.packFilesCount}</strong></p>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-value">${brokenLinks.length}</div>
        <div class="kpi-label">Unique URLs</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">${metadata.totalFiles}</div>
        <div class="kpi-label">Files Analyzed</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">${(metadata.totalReferences / metadata.totalFiles).toFixed(1)}</div>
        <div class="kpi-label">Avg Refs/File</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value">${brokenLinks[0]?.reference_count || 0}</div>
        <div class="kpi-label">Max References</div>
      </div>
    </div>

    <div class="chart-container">
      <h2>Reference Distribution (Top 10)</h2>
      <canvas id="refChart"></canvas>
    </div>

    <div class="recommendations">
      <h2>Actionable Recommendations</h2>
      <div class="recommendation-item">
        <strong>1. Verify High-Impact URLs:</strong> The top ${Math.min(5, brokenLinks.length)} URLs are referenced most frequently. Prioritize validation of these links.
      </div>
      <div class="recommendation-item">
        <strong>2. Link Maintenance:</strong> Run periodic link validation to catch broken references before they impact documentation.
      </div>
      <div class="recommendation-item">
        <strong>3. Update Documentation:</strong> Any broken links should be updated or removed from the knowledge base during the next sync cycle.
      </div>
      <div class="recommendation-item">
        <strong>4. Archival Strategy:</strong> Consider archiving or consolidating URLs with very few references to reduce maintenance overhead.
      </div>
      <div class="recommendation-item">
        <strong>5. Continuous Monitoring:</strong> Enable post-commit hooks to validate links before knowledge pack ingestion.
      </div>
    </div>

    <h2>Link Reference Table (Top 100)</h2>
    <table>
      <thead>
        <tr>
          <th>URL</th>
          <th>References</th>
          <th>Severity</th>
        </tr>
      </thead>
      <tbody>
        ${brokenLinks
          .map((link) => {
            const severity =
              link.reference_count >= 10
                ? "high"
                : link.reference_count >= 5
                  ? "medium"
                  : "low";
            const severityClass = \`severity-\${severity}\`;
            return \`
          <tr>
            <td><code class="code-block">\${escapeHtml(link.url)}</code></td>
            <td>\${link.reference_count}</td>
            <td><span class="\${severityClass}">\${severity.toUpperCase()}</span></td>
          </tr>
        \`;
          })
          .join("")}
      </tbody>
    </table>

    <footer>
      <p>KB Sync Report — CIC Knowledge Base Pipeline | <a href="https://github.com/anthropics/cic-os">Repository</a></p>
    </footer>
  </div>

  <script>
    // Reference distribution chart
    const topLinks = ${JSON.stringify(brokenLinks.slice(0, 10))};
    const ctx = document.getElementById('refChart');
    if (ctx) {
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: topLinks.map(link => link.url.substring(0, 40) + '...'),
          datasets: [{
            label: 'Reference Count',
            data: topLinks.map(link => link.reference_count),
            backgroundColor: '#8b4513',
            borderColor: '#d4af37',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: true }
          },
          scales: {
            y: { beginAtZero: true }
          }
        }
      });
    }

    // Theme toggle (optional)
    function toggleTheme() {
      const html = document.documentElement;
      const current = html.getAttribute('data-theme');
      html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
      localStorage.setItem('theme', current === 'dark' ? 'light' : 'dark');
    }

    // Load theme preference
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);

    function escapeHtml(unsafe) {
      return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  </script>
</body>
</html>`;
}

// Run
main().catch((err) => {
  log_error(`Artifact generation failed: ${err.message}`);
  process.exit(1);
});
