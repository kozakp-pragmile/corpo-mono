export function kpiPerOrganisationDashboard({ title = `Operating cost by organisation ${Date.now()}`, kpi = "2102456963588136215" } = {}) {
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
