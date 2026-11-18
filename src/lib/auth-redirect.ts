export function portalOrigin(portal: "student" | "staff") {
  const deploymentHost = process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const shared = process.env.CAMPUSBITE_STAFF_ORIGIN?.trim() || (deploymentHost ? "https://" + deploymentHost : undefined);
  const value = portal === "student" ? process.env.CAMPUSBITE_STUDENT_ORIGIN?.trim() || shared : shared;
  try {
    const url = new URL(value ?? "");
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    const host = url.hostname.replace(/\.$/, "");
    const local = host === "localhost" || host.endsWith(".localhost") || /^127(?:\.\d{1,3}){3}$/.test(host) ||
      host === "[::1]" || host === "0.0.0.0" || host === "[::]" || /^\[::ffff:7f[0-9a-f]{2}:/.test(host);
    if (local && process.env.NODE_ENV === "production") {
      return deploymentHost && /^[a-z0-9.-]+\.vercel\.app$/i.test(deploymentHost) ? "https://" + deploymentHost : null;
    }
    return url.protocol === "https:" || (local && url.protocol === "http:") ? url.origin : null;
  } catch {
    return null;
  }
}

export function authRedirect(path: string) {
  return new Response(null, {
    status: 303,
    headers: { Location: path, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
}
