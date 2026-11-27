import { BlockList, isIP } from "node:net";

function address(value: string | null) {
  const ip = value?.trim() ?? "";
  const family = isIP(ip);
  if (!family || ip.includes("%")) return null;
  if (family === 4) return ip;
  const canonical = new URL("http://[" + ip + "]").hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

function trustedRanges(cidrs: string) {
  const ranges = new BlockList();
  if (!cidrs.trim()) return ranges;
  for (const entry of cidrs.split(",")) {
    const match = /^([^/]+)\/(\d{1,3})$/.exec(entry.trim());
    if (!match) return null;
    const ip = address(match[1]);
    const prefix = Number(match[2]);
    if (!ip || prefix > (isIP(ip) === 4 ? 32 : 128)) return null;
    ranges.addSubnet(ip, prefix, isIP(ip) === 4 ? "ipv4" : "ipv6");
  }
  return ranges;
}

export function proxyAddressResolver(vercel: boolean, header = "", cidrs = "") {
  const selected = vercel ? "x-vercel-forwarded-for" : header.trim().toLowerCase();
  const ranges = selected === "x-forwarded-for" ? trustedRanges(cidrs) : null;
  return (headers: Pick<Headers, "get">): string | null => {
    if (vercel || selected === "cf-connecting-ip" || selected === "x-real-ip") return address(headers.get(selected));
    if (!ranges) return null;
    // The ingress appends its observed peer. Ignore everything to the left
    // once we reach the first address outside the configured proxy ranges.
    const hops = headers.get("x-forwarded-for")?.split(",") ?? [];
    for (let i = hops.length - 1; i >= 0; i--) {
      const ip = address(hops[i]);
      if (!ip) return null;
      if (!ranges.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6")) return ip;
    }
    return null;
  };
}
