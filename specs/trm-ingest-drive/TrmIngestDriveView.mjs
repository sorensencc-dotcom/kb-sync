/**
 * Visual translation view for TRM Ingest Drive
 */
export const title = "TRM Ingest Drive State Machine";

export const state = (vars) => {
  return String(vars.state || "Unknown");
};

export const step = (action, from, to) => {
  switch (action) {
    case "FileArrives": return "1. File arrives in buffer";
    case "DebounceSettles": return "2. Debounce window expires";
    case "ValidationFails": return "3a. Validation error -> Reject";
    case "DuplicateDetected": return "3b. Finding ID exists -> Skip";
    case "ValidNewFinding": return "3c. Valid new finding -> Acquire lock";
    case "AppendEvidenceAndArchive": return "4. Append to RFC -> Archive";
    case "ReleaseLockAndComplete": return "5. Release lease -> Completed";
    case "HandleRejected": return "Archive rejected -> Reset";
    case "HandleSkippedDuplicate": return "Archive duplicate -> Reset";
    case "ResetToBuffer": return "Cycle complete -> Wait for next";
    default: return action;
  }
};

export const group = (vars) => {
  if (vars.state === "INGESTING" || vars.state === "ARCHIVING") return "write_critical";
  if (vars.state === "COMPLETED") return "success";
  if (vars.state === "REJECTED" || vars.state === "SKIPPED_DUPLICATE") return "filtered";
  return "active";
};

export const colors = {
  active: "blue",
  write_critical: "orange",
  success: "teal",
  filtered: "purple"
};
