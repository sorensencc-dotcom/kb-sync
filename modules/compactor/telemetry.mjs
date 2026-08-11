import { getEncoding } from 'js-tiktoken';

let globalTokenizer = null;

function getTokenizer() {
  if (!globalTokenizer) {
    try {
      globalTokenizer = getEncoding('cl100k_base');
    } catch (_) {
      globalTokenizer = null;
    }
  }
  return globalTokenizer;
}

export function countTokens(text) {
  if (!text) return 0;
  const tokenizer = getTokenizer();
  if (tokenizer) {
    try {
      return tokenizer.encode(text).length;
    } catch (_) {}
  }
  return Math.ceil(text.length / 4);
}
