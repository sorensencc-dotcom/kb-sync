import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateCategoriesData } from '../../core/config.mjs';

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
