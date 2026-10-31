import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateCategoriesData, saveCategoriesData, getMasterKbExclusions, buildNotebookTargetMap } from '../../core/config.mjs';
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

describe('buildNotebookTargetMap', () => {
  test('builds a map mapping canonical keys to targets', () => {
    const data = {
      categories: {
        'test-category': {
          target: 'uuid-1234',
          title: 'Test Category',
          status: 'canonical'
        }
      }
    };
    const result = buildNotebookTargetMap(data);
    assert.deepEqual(result, {
      'test-category': 'uuid-1234'
    });
  });

  test('includes aliases mapping to the same targets', () => {
    const data = {
      categories: {
        'test-category': {
          target: 'uuid-1234',
          title: 'Test Category',
          status: 'canonical',
          aliases: ['alias1', 'alias2']
        }
      }
    };
    const result = buildNotebookTargetMap(data);
    assert.deepEqual(result, {
      'test-category': 'uuid-1234',
      'alias1': 'uuid-1234',
      'alias2': 'uuid-1234'
    });
  });

  test('normalizes keys and aliases (lowercases and trims)', () => {
    const data = {
      categories: {
        '  TEST-CATEGORY  ': {
          target: 'uuid-1234',
          title: 'Test Category',
          status: 'canonical',
          aliases: ['  ALIAS1  ', 'aLiAs2']
        }
      }
    };
    const result = buildNotebookTargetMap(data);
    assert.deepEqual(result, {
      'test-category': 'uuid-1234',
      'alias1': 'uuid-1234',
      'alias2': 'uuid-1234'
    });
  });

  test('safely handles an empty or missing categories object in categoriesData', () => {
    assert.deepEqual(buildNotebookTargetMap({}), {});
    assert.deepEqual(buildNotebookTargetMap({ categories: {} }), {});
    assert.deepEqual(buildNotebookTargetMap({ categories: null }), {});
  });

  test('safely handles category definitions that do not have an aliases array', () => {
    const data = {
      categories: {
        'test-category': {
          target: 'uuid-1234',
          title: 'Test Category',
          status: 'canonical'
        }
      }
    };
    const result = buildNotebookTargetMap(data);
    assert.deepEqual(result, {
      'test-category': 'uuid-1234'
    });
  });
});
