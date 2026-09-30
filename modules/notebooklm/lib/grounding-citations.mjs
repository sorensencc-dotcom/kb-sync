// `nlm query notebook --json` returns citations as { <number>: <source id> }
// with no titles; join against `nlm source list --json` to recover them.
export function resolveCitations(query, sources) {
  const titles = new Map((sources || []).map((s) => [s.id, s.title]));
  const ids = [...new Set(Object.values(query?.citations || {}))];
  return ids.map((id) => ({ source_id: id, source_name: titles.get(id) ?? null }));
}
