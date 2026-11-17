import yaml from 'js-yaml';
import { ALLOWED_CATEGORIES, ALLOWED_STATUSES } from './validate-contract.mjs';

function invalid(message) {
  const error = new Error(`Invalid wiki frontmatter: ${message}`);
  error.code = 'WIKI_METADATA_INVALID';
  return error;
}

function sanitizeYamlScalarLines(rawHeader) {
  return rawHeader
    .replace(
      /^([ \t]*(?:title|source_title|description|summary):[ \t]+)(?!["'\[{|>-])(.+:[ \t]+.+)$/gm,
      (_, prefix, value) => `${prefix}${JSON.stringify(value.trim())}`
    )
    .replace(
      /^([ \t]*(?:title|source_title|description|summary):[ \t]+)"(.*)"[ \t]*$/gm,
      (line, prefix, inner) => {
        if (!inner.includes('\\$') && !/(?<!\\)"/.test(inner)) return line;
        const cleaned = inner.replace(/\\\$/g, '$').replace(/\\"/g, '"');
        return `${prefix}${JSON.stringify(cleaned)}`;
      }
    );
}

export function parseWikiFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) {
    if (/^---(?:\r?\n|$)/.test(content)) throw invalid('missing closing YAML delimiter');
    return { frontmatter: {}, body: content, hasFrontmatter: false, sanitizedYaml: false };
  }
  let frontmatter;
  let sanitizedYaml = false;
  try {
    frontmatter = match[1].trim() === '' ? {} : yaml.load(match[1]);
  } catch (error) {
    const sanitized = sanitizeYamlScalarLines(match[1]);
    if (sanitized !== match[1]) {
      try {
        frontmatter = yaml.load(sanitized);
        sanitizedYaml = true;
      } catch {
        throw invalid(error.message);
      }
    } else {
      throw invalid(error.message);
    }
  }
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter) || frontmatter instanceof Date) throw invalid('YAML header must be a mapping');
  if (typeof frontmatter.title === 'number' || typeof frontmatter.title === 'boolean') {
    frontmatter.title = String(frontmatter.title);
    sanitizedYaml = true;
  }
  for (const key of ['title', 'source_title', 'category', 'status', 'sourceRepository']) {
    if (frontmatter[key] !== undefined && typeof frontmatter[key] !== 'string') throw invalid(`${key} must be a string`);
  }
  return { frontmatter, body: match[2], hasFrontmatter: true, sanitizedYaml };
}

export function formatWikiFrontmatter(frontmatter, body, eol = '\n') {
  if (!ALLOWED_CATEGORIES.has(frontmatter.category)) throw invalid(`unsupported category '${frontmatter.category}'`);
  if (!ALLOWED_STATUSES.has(frontmatter.status)) throw invalid(`unsupported status '${frontmatter.status}'`);
  let header;
  try { header = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true }).replace(/\n/g, eol); }
  catch (error) { throw invalid(error.message); }
  return `---${eol}${header}${eol}---${eol}${body}`;
}
