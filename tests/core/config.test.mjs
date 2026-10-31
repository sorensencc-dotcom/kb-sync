import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateCategoriesData, saveCategoriesData, getMasterKbExclusions, resolveNotebookId } from '../../core/config.mjs';
import fs from 'node:fs';

describe('validateCategoriesData', () => {
  test('returns true for a valid category data object', () => {
    const validData = {
      categories: {
        'test-category': {
          target: 'uuid-1234',
          title: 'Test Category',
          status: 'canonical',
          aliases: ['tc', 'test-cat']
        }
      },
      placeholders: {
        'placeholder::test': {
          status: 'unmapped'
        }
      }
    };
    assert.equal(validateCategoriesData(validData), true);
  });

  test('throws if data is not an object', () => {
    assert.throws(
      () => validateCategoriesData(null),
      /CATEGORY_INVARIANT_VIOLATION: Data must be a non-null object/
    );
    assert.throws(
      () => validateCategoriesData('string'),
      /CATEGORY_INVARIANT_VIOLATION: Data must be a non-null object/
    );
  });

  test('throws if categories is not an object', () => {
    assert.throws(
      () => validateCategoriesData({}),
      /CATEGORY_INVARIANT_VIOLATION: Missing categories object/
    );
    assert.throws(
      () => validateCategoriesData({ categories: null }),
      /CATEGORY_INVARIANT_VIOLATION: Missing categories object/
    );
  });

  test('throws if a category is missing a target', () => {
    const data = {
      categories: {
        'test-category': {
          title: 'Test Category',
          status: 'canonical'
        }
      }
    };
    assert.throws(
      () => validateCategoriesData(data),
      /CATEGORY_INVARIANT_VIOLATION: Category 'test-category' missing valid 'target' UUID/
    );
  });

  test('throws if a category is missing a title', () => {
    const data = {
      categories: {
        'test-category': {
          target: 'uuid-1234',
          status: 'canonical'
        }
      }
    };
    assert.throws(
      () => validateCategoriesData(data),
      /CATEGORY_INVARIANT_VIOLATION: Category 'test-category' missing valid 'title' string/
    );
  });

  test('throws if a category status is not canonical', () => {
    const data = {
      categories: {
        'test-category': {
          target: 'uuid-1234',
          title: 'Test Category',
          status: 'archived'
        }
      }
    };
    assert.throws(
      () => validateCategoriesData(data),
      /CATEGORY_INVARIANT_VIOLATION: Category 'test-category' must have status 'canonical'/
    );
  });

  test('throws on alias collision across distinct categories', () => {
    const data = {
      categories: {
        'cat-1': {
          target: 'uuid-1',
          title: 'Category 1',
          status: 'canonical',
          aliases: ['shared-alias']
        },
        'cat-2': {
          target: 'uuid-2',
          title: 'Category 2',
          status: 'canonical',
          aliases: ['shared-alias']
        }
      }
    };
    assert.throws(
      () => validateCategoriesData(data),
      /CATEGORY_CONFLICT: Alias collision for 'shared-alias' across distinct categories/
    );
  });

  test('allows shared alias if target is the same', () => {
    const data = {
      categories: {
        'cat-1': {
          target: 'uuid-1',
          title: 'Category 1',
          status: 'canonical',
          aliases: ['shared-alias']
        },
        'cat-2': {
          target: 'uuid-1',
          title: 'Category 2',
          status: 'canonical',
          aliases: ['shared-alias']
        }
      }
    };
    assert.equal(validateCategoriesData(data), true);
  });

  test('throws if placeholder key does not start with placeholder::', () => {
    const data = {
      categories: {
        'cat-1': {
          target: 'uuid-1',
          title: 'Category 1',
          status: 'canonical'
        }
      },
      placeholders: {
        'invalid-key': {
          status: 'unmapped'
        }
      }
    };
    assert.throws(
      () => validateCategoriesData(data),
      /CATEGORY_INVARIANT_VIOLATION: Placeholder key 'invalid-key' must start with 'placeholder::'/
    );
  });

  test('throws if placeholder has invalid status', () => {
    const data = {
      categories: {
        'cat-1': {
          target: 'uuid-1',
          title: 'Category 1',
          status: 'canonical'
        }
      },
      placeholders: {
        'placeholder::test': {
          status: 'invalid-status'
        }
      }
    };
    assert.throws(
      () => validateCategoriesData(data),
      /CATEGORY_INVARIANT_VIOLATION: Placeholder 'placeholder::test' invalid status 'invalid-status'/
    );
  });
});

describe('saveCategoriesData', () => {
  const validData = {
    categories: {
      'test-category': {
        target: 'uuid-1234',
        title: 'Test Category',
        status: 'canonical'
      }
    }
  };

  test('successfully writes to tmp and renames', (t) => {
    t.mock.method(fs, 'writeFileSync', () => {});
    t.mock.method(fs, 'renameSync', () => {});

    saveCategoriesData(validData);

    assert.equal(fs.writeFileSync.mock.calls.length, 1);
    assert.equal(fs.renameSync.mock.calls.length, 1);

    const writeArgs = fs.writeFileSync.mock.calls[0].arguments;
    assert.ok(writeArgs[0].endsWith('categories.json.tmp'));
    assert.equal(writeArgs[1], JSON.stringify(validData, null, 2));
    assert.equal(writeArgs[2], 'utf8');

    const renameArgs = fs.renameSync.mock.calls[0].arguments;
    assert.ok(renameArgs[0].endsWith('categories.json.tmp'));
    assert.ok(renameArgs[1].endsWith('categories.json'));
  });

  test('throws early if data is invalid without writing', (t) => {
    t.mock.method(fs, 'writeFileSync', () => {});

    assert.throws(
      () => saveCategoriesData(null),
      /CATEGORY_INVARIANT_VIOLATION/
    );
    assert.equal(fs.writeFileSync.mock.calls.length, 0);
  });

  test('cleans up tmp file and throws if rename fails', (t) => {
    t.mock.method(fs, 'writeFileSync', () => {});
    t.mock.method(fs, 'renameSync', () => { throw new Error('Rename failed'); });
    t.mock.method(fs, 'existsSync', () => true);
    t.mock.method(fs, 'unlinkSync', () => {});

    assert.throws(
      () => saveCategoriesData(validData),
      /Failed to atomically save categories.json: Rename failed/
    );

    assert.equal(fs.existsSync.mock.calls.length, 1);
    assert.equal(fs.unlinkSync.mock.calls.length, 1);
    assert.ok(fs.unlinkSync.mock.calls[0].arguments[0].endsWith('categories.json.tmp'));
  });

  test('cleans up tmp file and throws if write fails', (t) => {
    t.mock.method(fs, 'writeFileSync', () => { throw new Error('Write failed'); });
    t.mock.method(fs, 'existsSync', () => true);
    t.mock.method(fs, 'unlinkSync', () => {});

    assert.throws(
      () => saveCategoriesData(validData),
      /Failed to atomically save categories.json: Write failed/
    );

    assert.equal(fs.existsSync.mock.calls.length, 1);
    assert.equal(fs.unlinkSync.mock.calls.length, 1);
  });

  test('preserves original error if unlinkSync also throws', (t) => {
    t.mock.method(fs, 'writeFileSync', () => {});
    t.mock.method(fs, 'renameSync', () => { throw new Error('Rename failed'); });
    t.mock.method(fs, 'existsSync', () => true);
    t.mock.method(fs, 'unlinkSync', () => { throw new Error('Unlink failed'); });

    assert.throws(
      () => saveCategoriesData(validData),
      /Failed to atomically save categories.json: Rename failed/
    );

    assert.equal(fs.unlinkSync.mock.calls.length, 1);
  });
});

describe('getMasterKbExclusions', () => {
  test('returns set of keys with exclude_from_master_kb flag', () => {
    const data = {
      categories: {
        'cat-1': { exclude_from_master_kb: true },
        'cat-2': { exclude_from_master_kb: false },
        'cat-3': { }, // flag not present
        'cat-4': { exclude_from_master_kb: true }
      }
    };
    const exclusions = getMasterKbExclusions(data);
    assert.ok(exclusions instanceof Set);
    assert.equal(exclusions.size, 2);
    assert.ok(exclusions.has('cat-1'));
    assert.ok(exclusions.has('cat-4'));
    assert.ok(!exclusions.has('cat-2'));
    assert.ok(!exclusions.has('cat-3'));
  });

  test('returns empty set if no categories are excluded', () => {
    const data = {
      categories: {
        'cat-1': { exclude_from_master_kb: false },
        'cat-2': { }
      }
    };
    const exclusions = getMasterKbExclusions(data);
    assert.ok(exclusions instanceof Set);
    assert.equal(exclusions.size, 0);
  });

  test('handles empty or missing categories object safely', () => {
    const dataMissing = {};
    const exclusionsMissing = getMasterKbExclusions(dataMissing);
    assert.ok(exclusionsMissing instanceof Set);
    assert.equal(exclusionsMissing.size, 0);

    const dataEmpty = { categories: {} };
    const exclusionsEmpty = getMasterKbExclusions(dataEmpty);
    assert.ok(exclusionsEmpty instanceof Set);
    assert.equal(exclusionsEmpty.size, 0);
  });
});

describe('resolveNotebookId', () => {
  test('returns daily fallback target for empty or null category', (t) => {
    // Note: since this test runs against actual categories.json unless mocked,
    // we mock it so we know exactly what daily evaluates to.
    const mockData = {
      categories: {
        'daily': { target: 'daily-target-uuid', title: 'Daily', status: 'canonical' }
      }
    };
    t.mock.method(fs, 'existsSync', () => true);
    t.mock.method(fs, 'readFileSync', () => JSON.stringify(mockData));

    assert.equal(resolveNotebookId(null), '1b4861a3-931f-4632-8fc1-343a8dd37df8');
    assert.equal(resolveNotebookId(''), '1b4861a3-931f-4632-8fc1-343a8dd37df8');
  });

  test('resolves known category correctly with normalization', (t) => {
    const mockData = {
      categories: {
        'daily': { target: 'daily-target-uuid', title: 'Daily', status: 'canonical' },
        'known-cat': { target: 'known-target-uuid', title: 'Known', status: 'canonical', aliases: ['kc'] }
      }
    };
    t.mock.method(fs, 'existsSync', () => true);
    t.mock.method(fs, 'readFileSync', () => JSON.stringify(mockData));

    assert.equal(resolveNotebookId('KNOWN-cat '), 'known-target-uuid');
    assert.equal(resolveNotebookId('  kc'), 'known-target-uuid');
  });

  test('generates a placeholder and saves data for unknown category', (t) => {
    const mockData = {
      categories: {
        'daily': { target: 'daily-target-uuid', title: 'Daily', status: 'canonical' }
      },
      placeholders: {}
    };
    t.mock.method(fs, 'existsSync', () => true);
    t.mock.method(fs, 'readFileSync', () => JSON.stringify(mockData));

    let savedData = null;
    t.mock.method(fs, 'writeFileSync', (path, data) => {
      savedData = JSON.parse(data);
    });
    t.mock.method(fs, 'renameSync', () => {});
    t.mock.method(console, 'warn', () => {}); // suppress warning in test output

    const result = resolveNotebookId('New Topic');

    assert.equal(result, 'daily-target-uuid'); // Falls back to daily
    assert.equal(fs.writeFileSync.mock.calls.length, 1);
    assert.ok(savedData.placeholders['placeholder::new topic']);
    assert.equal(savedData.placeholders['placeholder::new topic'].status, 'unmapped');
    assert.equal(savedData.placeholders['placeholder::new topic'].slug, 'new topic');
    assert.equal(savedData.placeholders['placeholder::new topic'].fallback_notebook_id, 'daily-target-uuid');
    assert.equal(console.warn.mock.calls.length, 1); // warned by default
  });

  test('does not overwrite existing placeholder', (t) => {
    const mockData = {
      categories: {
        'daily': { target: 'daily-target-uuid', title: 'Daily', status: 'canonical' }
      },
      placeholders: {
        'placeholder::existing topic': {
          category: 'placeholder::existing topic',
          slug: 'existing topic',
          status: 'mapped'
        }
      }
    };
    t.mock.method(fs, 'existsSync', () => true);
    t.mock.method(fs, 'readFileSync', () => JSON.stringify(mockData));
    t.mock.method(fs, 'writeFileSync', () => {});

    const result = resolveNotebookId('Existing Topic');

    assert.equal(result, 'daily-target-uuid'); // returns daily target, but doesn't write
    assert.equal(fs.writeFileSync.mock.calls.length, 0); // No save operation
  });

  test('respects options.warnOnPlaceholder to suppress warning', (t) => {
    const mockData = {
      categories: {
        'daily': { target: 'daily-target-uuid', title: 'Daily', status: 'canonical' }
      }
    };
    t.mock.method(fs, 'existsSync', () => true);
    t.mock.method(fs, 'readFileSync', () => JSON.stringify(mockData));
    t.mock.method(fs, 'writeFileSync', () => {});
    t.mock.method(fs, 'renameSync', () => {});
    t.mock.method(console, 'warn', () => {});

    resolveNotebookId('Silent Topic', { warnOnPlaceholder: false });

    assert.equal(console.warn.mock.calls.length, 0);
  });
});
