// kb-sync/core/config.mjs
export const NOTEBOOK_TARGETS = {
  'willow-run': '6fd7c40b-df90-444b-9c7a-a64682925856', // CIC - Willow Run & Aviation Engineering
  'ford-politics': '0caf6707-f8f2-4d2a-acd2-020acead55ba', // CIC - Ford Executive Dynamics & Politics
  'post-war': '9c469910-a900-43a4-877c-a43c9f545b5f', // CIC - Post-War & Willys-Overland
  'willys-overland': '9c469910-a900-43a4-877c-a43c9f545b5f', // CIC - Post-War & Willys-Overland (alias)
  'master-kb': '679b8bab-2d87-42cb-a726-6dc54c83acc2', // CIC-KB
  'daily': '1b4861a3-931f-4632-8fc1-343a8dd37df8' // CIC - Daily Research
};

export function resolveNotebookId(category) {
  if (!category) return NOTEBOOK_TARGETS['daily'];
  const normalized = String(category).toLowerCase().trim();
  return NOTEBOOK_TARGETS[normalized] || NOTEBOOK_TARGETS['daily'];
}
