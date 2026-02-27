import { describe, it, expect } from 'vitest';
import { formatLargeNumber, formatCurrency } from '../utils/formatters';

describe('formatLargeNumber', () => {
    it('소수 그대로 반환', () => {
        expect(formatLargeNumber(0)).toBe('0');
        expect(formatLargeNumber(999)).toBe('999');
    });

    it('1000 이상은 k 단위', () => {
        expect(formatLargeNumber(1000)).toBe('1.0k');
        expect(formatLargeNumber(1500)).toBe('1.5k');
        expect(formatLargeNumber(999999)).toBe('1000.0k');
    });

    it('1,000,000 이상은 M 단위', () => {
        expect(formatLargeNumber(1000000)).toBe('1.0M');
        expect(formatLargeNumber(2500000)).toBe('2.5M');
    });
});

describe('formatCurrency', () => {
    it('달러 기호 포함', () => {
        expect(formatCurrency(0)).toContain('$');
    });

    it('소수점 2자리 이상', () => {
        const result = formatCurrency(1.5);
        expect(result).toContain('1.50');
    });

    it('소수점 4자리까지 표시', () => {
        const result = formatCurrency(0.0001);
        expect(result).toContain('0.0001');
    });
});
