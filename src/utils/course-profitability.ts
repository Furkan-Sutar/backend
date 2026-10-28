export interface CourseProfitabilityInputs {
  revenue: number;
  fixedCosts: number;
  variableCosts: number;
  enrollments: number;
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Contribution excludes allocated fixed costs; estimated profit includes all direct costs. */
export function calculateCourseProfitability(input: CourseProfitabilityInputs) {
  const revenue = money(input.revenue);
  const fixedCosts = money(input.fixedCosts);
  const variableCosts = money(input.variableCosts);
  const enrollments = Math.max(0, Math.floor(input.enrollments));
  const directCost = money(fixedCosts + variableCosts);
  const contribution = money(revenue - variableCosts);
  const contributionMargin = revenue > 0 ? money((contribution / revenue) * 100) : null;
  const contributionPerEnrollment = enrollments > 0 ? money(contribution / enrollments) : null;
  const breakEvenEnrollments = contributionPerEnrollment !== null && contributionPerEnrollment > 0
    ? Math.ceil(fixedCosts / contributionPerEnrollment)
    : null;
  return {
    revenue,
    directCost,
    fixedCosts,
    variableCosts,
    contribution,
    contributionMargin,
    estimatedProfit: money(revenue - directCost),
    enrollments,
    contributionPerEnrollment,
    breakEvenEnrollments,
    breakEvenReached: breakEvenEnrollments === null ? null : enrollments >= breakEvenEnrollments,
    formulas: {
      contribution: 'revenue - variable costs',
      contributionMargin: 'contribution / revenue * 100',
      estimatedProfit: 'revenue - fixed costs - variable costs',
      breakEvenEnrollments: 'ceil(fixed costs / contribution per enrollment)',
      contributionPerEnrollment: 'contribution / current enrollments'
    }
  };
}
