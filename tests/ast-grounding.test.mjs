import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCodeSymbols,
  fetchSymbolAstGraph,
  fetchAstBlastRadius,
  formatAstGroundingSection,
} from '../modules/trm/ast-grounding.mjs';

describe('AST Call-Graph Grounding (Path C)', () => {
  describe('Symbol Extraction', () => {
    test('extracts backticked identifiers, camelCase functions, and source files', () => {
      const text = 'Investigate `handleQueryContextCache` and `DatabaseSync` in `modules/cache/db-schema.mjs` for memory leaks with queryExpander.';
      const symbols = extractCodeSymbols(text);

      assert.ok(symbols.includes('handleQueryContextCache'));
      assert.ok(symbols.includes('DatabaseSync'));
      assert.ok(symbols.includes('db-schema.mjs'));
      assert.ok(symbols.includes('queryExpander'));
    });

    test('ignores generic english words and short noise', () => {
      const text = 'The this that with from have been will';
      const symbols = extractCodeSymbols(text);
      assert.equal(symbols.length, 0);
    });

    test('handles empty or non-string input safely', () => {
      assert.deepEqual(extractCodeSymbols(''), []);
      assert.deepEqual(extractCodeSymbols(null), []);
    });
  });

  describe('Graft Execution & Fail-Soft Parsing', () => {
    test('parses callers, callees, and file:line spans from graft output mock', () => {
      const mockExec = () => `
handleQueryContextCache (covers: modules/cache/context-cache.mjs:45-80)
  <- executeGapTriage (modules/trm/gap-triage-engine.mjs:120)
  -> getDatabase (modules/cache/db-schema.mjs:55)
      `;

      const res = fetchSymbolAstGraph('handleQueryContextCache', {
        execFn: mockExec,
      });

      assert.ok(res);
      assert.equal(res.symbol, 'handleQueryContextCache');
      assert.equal(res.spans.length, 3);
      assert.ok(res.spans[0].includes('context-cache.mjs:45-80'));
      assert.equal(res.callers.length, 1);
      assert.equal(res.callees.length, 1);
    });

    test('fails soft and returns null when graft command throws or exits non-zero', () => {
      const throwingExec = () => {
        throw new Error('Command failed: graft callers');
      };

      const res = fetchSymbolAstGraph('nonExistentSymbol', {
        execFn: throwingExec,
      });

      assert.equal(res, null);
    });

    test('fetches blast radius across multiple candidate symbols', () => {
      const mockExec = (cmd) => {
        if (cmd.includes('handleQueryContextCache')) {
          return 'handleQueryContextCache (modules/cache/context-cache.mjs:45)\n  <- main';
        }
        return '';
      };

      const results = fetchAstBlastRadius(['handleQueryContextCache', 'unknownSym'], {
        execFn: mockExec,
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].symbol, 'handleQueryContextCache');
    });
  });

  describe('Markdown Section Formatting', () => {
    test('formats AST section with spans and callers', () => {
      const astResults = [
        {
          symbol: 'executeGapTriage',
          spans: ['modules/trm/gap-triage-engine.mjs:50-90'],
          callers: ['<- trm-triage.mjs:30'],
          callees: ['-> triageGapAgainstCache:65'],
          rawOutput: 'executeGapTriage tree',
        },
      ];

      const md = formatAstGroundingSection(astResults);
      assert.ok(md.includes('### 3. AST Call-Graph & Blast Radius Analysis'));
      assert.ok(md.includes('`executeGapTriage`'));
      assert.ok(md.includes('modules/trm/gap-triage-engine.mjs:50-90'));
      assert.ok(md.includes('trm-triage.mjs:30'));
    });

    test('formats fallback note when no symbols found', () => {
      const md = formatAstGroundingSection([]);
      assert.ok(md.includes('*No static call-graph symbols detected'));
    });
  });
});
