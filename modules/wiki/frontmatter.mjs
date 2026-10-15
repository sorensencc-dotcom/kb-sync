import yaml from 'js-yaml';
import { ALLOWED_CATEGORIES, ALLOWED_STATUSES } from './validate-contract.mjs';

function invalid(message) {
  const error = new Error(`Invalid wiki frontmatter: ${message}`);
  error.code = 'WIKI_METADATA_INVALID';
  return error;
}

export function parseWikiFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) {
    if (/^---(?:\r?\n|$)/.test(content)) throw invalid('missing closing YAML delimiter');
    return { frontmatter: {}, body: content, hasFrontmatter: false };
  }
  let frontmatter;
  try { frontmatter = match[1].trim() === '' ? {} : yaml.load(match[1]); }
  catch (error) { throw invalid(error.message); }
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter) || frontmatter instanceof Date) throw invalid('YAML header must be a mapping');
  for (const key of ['title', 'source_title', 'category', 'status', 'sourceRepository']) {
    if (frontmatter[key] !== undefined && typeof frontmatter[key] !== 'string') throw invalid(`${key} must be a string`);
  }
  return { frontmatter, body: match[2], hasFrontmatter: true };
}

export function formatWikiFrontmatter(frontmatter, body, eol = '\n') {
  if (!ALLOWED_CATEGORIES.has(frontmatter.category)) throw invalid(`unsupported category '${frontmatter.category}'`);
  if (!ALLOWED_STATUSES.has(frontmatter.status)) throw invalid(`unsupported status '${frontmatter.status}'`);
  let header;
  try { header = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true }).replace(/\n/g, eol); }
  catch (error) { throw invalid(error.message); }
  return `---${eol}${header}${eol}---${eol}${body}`;
}
