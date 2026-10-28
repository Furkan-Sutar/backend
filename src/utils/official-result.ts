export function calculateOfficialResult(marks: number, totalMarks: number, passMarks: number) {
  if (!Number.isFinite(marks) || !Number.isFinite(totalMarks) || !Number.isFinite(passMarks) || totalMarks <= 0 || marks < 0 || marks > totalMarks || passMarks < 0 || passMarks > totalMarks) {
    throw new RangeError('Result marks must be within the configured exam totals');
  }
  const percentage = Math.round((marks / totalMarks) * 10000) / 100;
  const grade = percentage >= 90 ? 'A' : percentage >= 80 ? 'B' : percentage >= 70 ? 'C' : percentage >= 60 ? 'D' : percentage >= 50 ? 'E' : 'F';
  return { percentage, grade, passFail: marks >= passMarks ? 'PASS' as const : 'FAIL' as const };
}
