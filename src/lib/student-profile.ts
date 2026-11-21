export function studentProfile(metadata: Record<string, unknown> = {}) {
  const name = metadata.campusbite_name ?? metadata.full_name ?? metadata.name;
  return {
    name: typeof name === "string" ? name.slice(0, 80) : "",
    orderAlerts: metadata.campusbite_order_alerts !== false,
    refundAlerts: metadata.campusbite_refund_alerts !== false,
  };
}

export type StudentProfile = ReturnType<typeof studentProfile>;
