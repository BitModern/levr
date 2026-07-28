import { describe, it, expect } from 'vitest';

import {
  applyOverrides,
  columnsNeedingReview,
  missingRequired,
  parseMapFlag,
  type MappingEntry,
} from '../utils/import-mapping.js';

function entry(
  originalName: string,
  targetProperty: MappingEntry['targetProperty'],
  matchType: MappingEntry['matchType'] = 'exact',
  confidence = 1,
): MappingEntry {
  return { originalName, targetProperty, matchType, confidence };
}

describe('levr import — mapping review logic', () => {
  describe('parseMapFlag', () => {
    it('parses "Source Column=target"', () => {
      expect(parseMapFlag('Title=test_name')).toEqual({
        column: 'Title',
        target: 'test_name',
      });
    });

    it('parses a trailing "=" as an explicit drop', () => {
      expect(parseMapFlag('QA Notes=')).toEqual({
        column: 'QA Notes',
        target: null,
      });
    });

    it('rejects unknown targets with the valid list', () => {
      expect(() => parseMapFlag('Title=not_a_field')).toThrow(/Valid targets:/);
    });

    it('parses "labels:prefix" as an import-as-labels override', () => {
      expect(parseMapFlag('State=labels:state')).toEqual({
        column: 'State',
        target: 'labels',
        labelPrefix: 'state',
      });
    });

    it('rejects "labels:" with no prefix', () => {
      expect(() => parseMapFlag('State=labels:')).toThrow(/needs a prefix/);
    });

    it('rejects malformed pairs', () => {
      expect(() => parseMapFlag('no-separator')).toThrow(/--map/);
    });
  });

  describe('applyOverrides', () => {
    it('marks overridden columns as user-confirmed', () => {
      const mapping = [entry('Title', null, 'unmapped', 0)];
      const result = applyOverrides(mapping, [
        { column: 'Title', target: 'test_name' },
      ]);
      expect(result[0]).toMatchObject({
        targetProperty: 'test_name',
        matchType: 'manual',
        confidence: 1,
      });
      // labels:prefix override carries the prefix onto the entry
      const prefixed = applyOverrides(mapping, [
        { column: 'Title', target: 'labels', labelPrefix: 'state' },
      ]);
      expect(prefixed[0]).toMatchObject({
        targetProperty: 'labels',
        labelPrefix: 'state',
      });
      // original untouched (pure)
      expect(mapping[0]?.targetProperty).toBeNull();
    });

    it('fails loudly on a column not present in the file', () => {
      expect(() =>
        applyOverrides(
          [entry('Title', 'test_name')],
          [{ column: 'Typo', target: null }],
        ),
      ).toThrow(/not found in the file/);
    });
  });

  describe('missingRequired', () => {
    it('flags test_name until some column covers it', () => {
      expect(missingRequired([entry('Steps', 'steps')])).toEqual(['test_name']);
      expect(
        missingRequired([entry('Steps', 'steps'), entry('Title', 'test_name')]),
      ).toEqual([]);
    });
  });

  describe('columnsNeedingReview', () => {
    it('selects unmapped and low-confidence LLM columns only', () => {
      const mapping = [
        entry('exact', 'test_name', 'exact', 1),
        entry('good-llm', 'folder_path', 'llm', 0.85),
        entry('shaky-llm', 'estimate', 'llm', 0.55),
        entry('lost', null, 'unmapped', 0),
      ];
      expect(columnsNeedingReview(mapping).map((m) => m.originalName)).toEqual([
        'shaky-llm',
        'lost',
      ]);
    });
  });
});
