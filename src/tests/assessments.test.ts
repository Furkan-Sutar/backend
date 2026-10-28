import { describe, expect, it } from 'vitest';
import { calculateOfficialResult } from '../utils/official-result.js';
import { ROLE_PERMISSIONS } from '../types/rbac.js';

describe('official assessment results and access grants', () => {
  it('calculates percentage, grade, and pass status from server marks', () => {
    expect(calculateOfficialResult(45, 50, 30)).toEqual({ percentage: 90, grade: 'A', passFail: 'PASS' });
    expect(calculateOfficialResult(24, 50, 30)).toEqual({ percentage: 48, grade: 'F', passFail: 'FAIL' });
  });

  it('rejects result marks outside the exam totals', () => {
    expect(() => calculateOfficialResult(51, 50, 30)).toThrow(RangeError);
    expect(() => calculateOfficialResult(-1, 50, 30)).toThrow(RangeError);
  });

  it('grants students attempt and published-result viewing, but not grading or publication', () => {
    expect(ROLE_PERMISSIONS.STUDENT).toContain('exam.attempt');
    expect(ROLE_PERMISSIONS.STUDENT).toContain('result.view');
    expect(ROLE_PERMISSIONS.STUDENT).not.toContain('result.update');
    expect(ROLE_PERMISSIONS.STUDENT).not.toContain('result.publish');
  });

  it('grants teachers assessment management and result publication', () => {
    expect(ROLE_PERMISSIONS.TEACHER).toContain('assignment.create');
    expect(ROLE_PERMISSIONS.TEACHER).toContain('exam.update');
    expect(ROLE_PERMISSIONS.TEACHER).toContain('result.update');
    expect(ROLE_PERMISSIONS.TEACHER).toContain('result.publish');
  });
});
