// `nlm query notebook --json` returns citations as { <number>: <source id> }
// with no titles; join against `nlm source list --json` to recover them.
export function resolveCitations(query, sources) {
  const titles = new Map((sources || []).map((s) => [s.id || s.sourceId || s.source_id, s.title || s.name || s.displayName]));
  const ids = [...new Set(Object.values(query?.citations || {}))];
  return ids.map((id) => ({ source_id: id, source_name: titles.get(id) ?? null }));
}

export function hasPackGrounding(query, sources, prefixes) {
  return resolveCitations(query, sources).some(c => typeof c.source_name === 'string'
    && prefixes.some(prefix => c.source_name.startsWith(prefix)));
}
