export type DiagnosticKind = 'compiler' | 'linter' | 'unknown';

export interface Diagnostic {
  kind: DiagnosticKind;
  file: string;
  line: number;
  column?: number;
  code?: string;
  message: string;
  raw: string;
}

export interface RepairAuditPacket {
  compilerOutput: string;
  linterOutput: string;
  declaredScope?: string[];
}

export interface Collision {
  file: string;
  line: number;
  diagnostics: Diagnostic[];
}

export interface RepairAuditResult {
  status: 'PASS' | 'FLAG';
  diagnostics: Diagnostic[];
  collisions: Collision[];
  recipe: string[];
}

const COMPILER = /^(.+?)\((\d+),(\d+)\):\s*(?:error|warning)\s+(TS\d+):\s*(.+)$/i;
const COMPILER_COLON = /^(.+?):(\d+):(\d+)\s*-?\s*(?:error|warning)\s+(TS\d+):\s*(.+)$/i;
const LINTER = /^(.+?):(\d+):(\d+):\s*(error|warning)\s+(.+?)(?:\s+([\w/-]+))?$/i;

function parseLine(raw: string, kind: DiagnosticKind): Diagnostic | undefined {
  const match = kind === 'compiler'
    ? raw.match(COMPILER) ?? raw.match(COMPILER_COLON)
    : raw.match(LINTER);
  if (!match) return undefined;
  if (kind === 'compiler') {
    return { kind, file: match[1], line: Number(match[2]), column: Number(match[3]), code: match[4], message: match[5].trim(), raw };
  }
  return { kind, file: match[1], line: Number(match[2]), column: Number(match[3]), code: match[6], message: match[5].trim(), raw };
}

export function parseDiagnostics(output: string, kind: DiagnosticKind): Diagnostic[] {
  return output.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .map(line => parseLine(line, kind)).filter((item): item is Diagnostic => Boolean(item));
}

export function findCollisions(diagnostics: Diagnostic[]): Collision[] {
  const grouped = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.file}:${diagnostic.line}`;
    const group = grouped.get(key) ?? [];
    group.push(diagnostic);
    grouped.set(key, group);
  }
  return [...grouped.entries()]
    .filter(([, items]) => new Set(items.map(item => item.kind)).size > 1)
    .map(([key, items]) => {
      const split = key.lastIndexOf(':');
      return { file: key.slice(0, split), line: Number(key.slice(split + 1)), diagnostics: items };
    });
}

export function buildRecipe(collisions: Collision[], diagnostics: Diagnostic[], declaredScope: string[] = []): string[] {
  const scopeViolations = diagnostics.filter(item => declaredScope.length > 0 && !declaredScope.includes(item.file));
  const recipe = ['Freeze the current working tree; do not apply edits while this audit is active.'];
  if (scopeViolations.length) recipe.push(`Restrict remediation to declared scope; ${scopeViolations.length} diagnostic(s) reference out-of-scope files.`);
  for (const collision of collisions) {
    const details = collision.diagnostics.map(item => `${item.kind} ${item.code ?? 'diagnostic'}: ${item.message}`).join('; ');
    recipe.push(`Resolve ${collision.file}:${collision.line} as one change set, then rerun the compiler and linter; ${details}.`);
  }
  if (!collisions.length && diagnostics.length) recipe.push('Resolve diagnostics in compiler-first order, rerun the compiler, then rerun the linter to detect remaining findings.');
  if (!diagnostics.length) recipe.push('No parseable compiler or linter diagnostics were found; rerun the failed gate with raw tool output attached.');
  recipe.push('Do not mark the repair complete until both gates pass and the final diff remains within declared scope.');
  return recipe;
}

export function auditRepair(packet: RepairAuditPacket): RepairAuditResult {
  const diagnostics = [...parseDiagnostics(packet.compilerOutput, 'compiler'), ...parseDiagnostics(packet.linterOutput, 'linter')];
  const collisions = findCollisions(diagnostics);
  return { status: diagnostics.length ? 'FLAG' : 'PASS', diagnostics, collisions, recipe: buildRecipe(collisions, diagnostics, packet.declaredScope) };
}
