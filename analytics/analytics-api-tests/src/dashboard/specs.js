// The rid of a KPI, the value Bedrock's kpiPerOrganisation source takes.
export const DEFAULT_KPI = "1926709094253226044";

export function kpiPerOrganisationDashboard({ title = `Operating cost by organisation ${Date.now()}`, kpi = DEFAULT_KPI } = {}) {
  return {
    schemaVersion: 2,
    title,
    tiles: [
      {
        type: "kpiPerOrganisation",
        title: "Operating cost across organisations",
        data: { source: "kpiPerOrganisation", kpi },
      },
    ],
  };
}
