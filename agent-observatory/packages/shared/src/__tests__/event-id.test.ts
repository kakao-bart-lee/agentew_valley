import { describe, it, expect } from 'vitest';
import { generateEventId, extractTimestamp } from '../utils/event-id.js';

describe('generateEventId', () => {
  it('should return a valid UUID v7 format', () => {
    const uuid = generateEventId();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(uuid).toMatch(uuidRegex);
  });

  it('should have version 7 in the correct position', () => {
    const uuid = generateEventId();
    // The 13th hex character (index 14 after first hyphen) should be '7'
    const parts = uuid.split('-');
    expect(parts[2][0]).toBe('7');
  });

  it('should have correct variant bits (10xx)', () => {
    const uuid = generateEventId();
    const parts = uuid.split('-');
    const variantChar = parts[3][0];
    expect(['8', '9', 'a', 'b']).toContain(variantChar);
  });

  it('should generate unique UUIDs', () => {
    const uuids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      uuids.add(generateEventId());
    }
    expect(uuids.size).toBe(100);
  });

  it('should encode the given timestamp', () => {
    const ts = 1709000000000; // Known timestamp
    const uuid = generateEventId(ts);
    const extracted = extractTimestamp(uuid);
    expect(extracted).toBe(ts);
  });

  it('should produce time-sortable UUIDs', () => {
    const ts1 = 1709000000000;
    const ts2 = 1709000001000;
    const ts3 = 1709000002000;

    const uuid1 = generateEventId(ts1);
    const uuid2 = generateEventId(ts2);
    const uuid3 = generateEventId(ts3);

    // Lexicographic sort should preserve time order
    const sorted = [uuid3, uuid1, uuid2].sort();
    expect(sorted).toEqual([uuid1, uuid2, uuid3]);
  });
});

describe('extractTimestamp', () => {
  it('should extract timestamp from UUID v7', () => {
    const now = Date.now();
    const uuid = generateEventId(now);
    const extracted = extractTimestamp(uuid);
    expect(extracted).toBe(now);
  });

  it('should roundtrip various timestamps', () => {
    const timestamps = [0, 1000, 1709000000000, Date.now()];
    for (const ts of timestamps) {
      const uuid = generateEventId(ts);
      expect(extractTimestamp(uuid)).toBe(ts);
    }
  });
});
