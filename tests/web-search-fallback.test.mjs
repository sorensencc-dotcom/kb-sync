import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { searchWebFallback } from '../modules/trm/web-search-fallback.mjs';

describe('searchWebFallback hardening', () => {
  test('empty/whitespace query returns [] and does not exec', () => {
    let calls = 0;
    const execFileSync = () => {
      calls += 1;
      throw new Error('should not run');
    };

    assert.deepEqual(searchWebFallback('', { execFileSync }), []);
    assert.deepEqual(searchWebFallback('   ', { execFileSync }), []);
    assert.deepEqual(searchWebFallback('\n\t  ', { execFileSync }), []);
    assert.equal(calls, 0);
  });

  test('parallel-cli success maps results as web-parallel', () => {
    const tempFiles = [];
    const execFileSync = (cmd, args) => {
      assert.equal(cmd, 'parallel-cli');
      assert.equal(args[0], 'search');
      const outPath = args[args.indexOf('-o') + 1];
      tempFiles.push(outPath);
      fs.writeFileSync(
        outPath,
        JSON.stringify({
          results: [
            {
              url: 'https://example.com/a',
              title: 'Alpha',
              excerpts: ['first', 'second']
            },
            {
              url: 'https://example.com/b',
              title: 'Beta',
              excerpts: []
            }
          ]
        })
      );
    };

    const results = searchWebFallback('node security', { limit: 3, execFileSync });
    assert.equal(results.length, 2);
    assert.equal(results[0].retrieval_mode, 'web-parallel');
    assert.equal(results[0].id, 'https://example.com/a');
    assert.equal(results[0].topic, 'Alpha');
    assert.equal(results[0].snippet, 'first second');
    assert.equal(results[1].topic, 'Beta');
    for (const f of tempFiles) {
      assert.equal(fs.existsSync(f), false, 'temp file should be cleaned up');
    }
  });

  test('parallel-cli fail falls back to tinyfish success as web-tinyfish', () => {
    const execFileSync = (cmd, args) => {
      if (cmd === 'parallel-cli') {
        throw new Error('parallel-cli unavailable');
      }
      assert.equal(cmd, 'tinyfish');
      assert.deepEqual(args.slice(0, 2), ['search', 'query']);
      return JSON.stringify({
        results: [
          {
            url: 'https://tiny.example/x',
            title: 'Tiny Hit',
            snippet: 'from tinyfish'
          }
        ]
      });
    };

    const results = searchWebFallback('fallback query', { execFileSync });
    assert.equal(results.length, 1);
    assert.equal(results[0].retrieval_mode, 'web-tinyfish');
    assert.equal(results[0].id, 'https://tiny.example/x');
    assert.equal(results[0].snippet, 'from tinyfish');
  });

  test('both providers fail returns []', () => {
    const execFileSync = () => {
      throw new Error('boom');
    };
    assert.deepEqual(searchWebFallback('anything', { execFileSync }), []);
  });

  test('shell metacharacters are passed as a single argv element', () => {
    const dangerous = 'foo"; rm -rf /; echo "bar';
    // Quotes are stripped by sanitization (replaced with spaces); metacharacters remain
    // but must still be a single argv element — never interpolated into a shell string.
    const sanitized = 'foo ; rm -rf /; echo  bar';
    /** @type {Array<[string, string[]]>} */
    const calls = [];
    const execFileSync = (cmd, args) => {
      calls.push([cmd, [...args]]);
      if (cmd === 'parallel-cli') throw new Error('force tinyfish path too');
      return JSON.stringify({ results: [] });
    };

    searchWebFallback(dangerous, { execFileSync });

    assert.ok(calls.length >= 1);
    for (const [cmd, args] of calls) {
      if (cmd === 'parallel-cli') {
        assert.equal(args[1], sanitized);
        assert.equal(typeof args[1], 'string');
        assert.ok(!args.some((a) => a.includes('parallel-cli search')));
      }
      if (cmd === 'tinyfish') {
        assert.equal(args[2], sanitized);
      }
    }
  });

  test('non-http URLs are filtered out', () => {
    const execFileSync = (cmd, args) => {
      assert.equal(cmd, 'parallel-cli');
      const outPath = args[args.indexOf('-o') + 1];
      fs.writeFileSync(
        outPath,
        JSON.stringify({
          results: [
            { url: 'javascript:alert(1)', title: 'Bad' },
            { url: 'file:///etc/passwd', title: 'Also bad' },
            { url: 'https://safe.example/', title: 'Good', excerpts: ['ok'] },
            { url: 'http://also-safe.example/', title: 'Also good', excerpts: ['ok2'] }
          ]
        })
      );
    };

    const results = searchWebFallback('urls', { execFileSync });
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((r) => r.id),
      ['https://safe.example/', 'http://also-safe.example/']
    );
  });

  test('limit is clamped to 1–10', () => {
    /** @type {string[]|null} */
    let seenArgs = null;
    const execFileSync = (cmd, args) => {
      seenArgs = args;
      const outPath = args[args.indexOf('-o') + 1];
      fs.writeFileSync(
        outPath,
        JSON.stringify({
          results: Array.from({ length: 20 }, (_, i) => ({
            url: `https://example.com/${i}`,
            title: `T${i}`,
            excerpts: [`s${i}`]
          }))
        })
      );
    };

    const high = searchWebFallback('limit high', { limit: 99, execFileSync });
    assert.equal(high.length, 10);
    assert.ok(seenArgs.includes('10'));

    seenArgs = null;
    const low = searchWebFallback('limit low', { limit: 0, execFileSync });
    assert.equal(low.length, 1);
    assert.ok(seenArgs.includes('1'));
  });
});
