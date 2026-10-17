// Credential redaction for remote URLs and for text that may quote them (git/execSync error messages, logs).
// Anything persisted to receipts, pipeline state or fleet reports goes through these first, so a token that is
// only meant to authenticate a push (an https URL whose userinfo is the token) is never written to disk.

const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s"'\/?#]+@/gi;

/** Split `scheme://userinfo@host/...` into its secret parts; null when the value carries no userinfo. */
function userinfoParts(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^\s"'\/?#]+)@/i.exec(String(url ?? ''));
  if (!m) return null;
  const raw = m[1];
  const colon = raw.indexOf(':');
  const user = colon >= 0 ? raw.slice(0, colon) : raw;
  const pass = colon >= 0 ? raw.slice(colon + 1) : '';
  return { raw, user, pass };
}

/**
 * Drop userinfo from a scheme URL: the part between the scheme and the host, ending in @, is removed, so
 * the URL keeps only scheme, host and path.
 * Values without userinfo (including scp-style git@github.com:o/r.git and non-URLs such as "prepare-only")
 * are returned unchanged.
 */
export function redactRemoteUrl(url) {
  if (typeof url !== 'string') return url;
  return url.replace(URL_USERINFO, '$1');
}

/**
 * Redact credentials in free text (an error message, a log line). Strips userinfo from every URL in the text and
 * also masks the literal user/password of any URL passed in `knownUrls`, in case they appear without the scheme.
 */
export function redactCredentialsInText(text, ...knownUrls) {
  let out = String(text ?? '').replace(URL_USERINFO, '$1');
  for (const url of knownUrls) {
    const parts = userinfoParts(url);
    if (!parts) continue;
    for (const secret of [parts.pass, parts.user, parts.raw]) {
      // Short values (e.g. "git") would mangle ordinary text; real tokens are longer than this.
      if (secret && secret.length >= 8) out = out.split(secret).join('***');
    }
  }
  return out;
}
