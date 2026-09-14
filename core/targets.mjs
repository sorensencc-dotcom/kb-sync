// C:\dev\kb-sync\core\targets.mjs
// Canonical NotebookLM Target Routing Map

export const NOTEBOOK_TARGETS = {
  // === Historical & Documentary Workstreams (CIC) ===
  'willow-run': '6fd7c40b-df90-444b-9c7a-a64682925856',       // CIC - Willow Run & Aviation Engineering
  'ford-politics': '0caf6707-f8f2-4d2a-acd2-020acead55ba',    // CIC - Ford Executive Dynamics & Politics
  'post-war': '9c469910-a900-43a4-877c-a43c9f545b5f',         // CIC - Post-War & Willys-Overland
  'willys-overland': '9c469910-a900-43a4-877c-a43c9f545b5f',  // Alias
  'cuba-claims': 'c8360946-dbee-4a2c-b622-7f89b05695b0',      // CIC - Cuban Seizures & Retired Assets
  'cuban-seizures': 'c8360946-dbee-4a2c-b622-7f89b05695b0',   // Alias
  'miami-estate': '64949154-5892-4fa4-9ad0-e48b2bf5cc6c',       // CIC - Miami Estate & Florida Retirement
  'assembly-line': '70be0df3-c58a-4711-b4d3-1e4b8726faf7',     // CIC - Rouge, Model T & Moving Assembly Line
  'master-kb': '679b8bab-2d87-42cb-a726-6dc54c83acc2',        // CIC-KB (Master Historical Pack Only)
  'daily': '1b4861a3-931f-4632-8fc1-343a8dd37df8',            // CIC - Daily Research (Buffer/Intake)

  // === Core Architecture & Software Engineering ===
  'ironledger': '76e1932c-054a-4520-9e83-5e882dffc938',       // Repurposed "Financial Statement and Docs" -> IronLedger Architecture
  'sigil': '26eacb85-2c97-443d-9d81-3bd99cc98412',               // Sigil Protocol & Federation
  'agent-harness': '359b346c-6af7-4ba3-baef-b985c9e6e1af',         // Agent Harnesses & Local Execution (Graft, SAM, Herdr)
  'rewrite-labs': '140119ae-3496-45c9-bf0c-71c955136afc',     // Rewrite Labs SSG/Redesign Platform
  'dev-triage': 'cb0498ce-1ea5-4668-9f65-ac368753404e',       // Open Dev Issues (CI/CD Triage Buffer)

  // === Personal OS & Operations ===
  'personal-os': '9724e682-c5ea-4693-8e21-caf8de68611e'        // Personal OS (Household, Utilities, Florida Logistics)
};

export function resolveNotebookId(category) {
  if (!category) return NOTEBOOK_TARGETS['daily'] || '1b4861a3-931f-4632-8fc1-343a8dd37df8';
  const normalized = String(category).toLowerCase().trim();
  return NOTEBOOK_TARGETS[normalized] || NOTEBOOK_TARGETS['daily'] || '1b4861a3-931f-4632-8fc1-343a8dd37df8';
}

export function extractFrontmatterCategory(content) {
  if (!content) return 'daily';
  const match = content.match(/^category:\s*([^#\r\n]+)/m);
  if (match && match[1]) {
    return match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return 'daily';
}
