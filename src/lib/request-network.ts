import "server-only";
import { headers } from "next/headers";
import { proxyAddressResolver } from "./proxy-address";

const resolveAddress = proxyAddressResolver(process.env.VERCEL === "1",
  process.env.CAMPUSBITE_TRUSTED_PROXY_HEADER, process.env.CAMPUSBITE_TRUSTED_PROXY_CIDRS);

export async function requestNetwork() {
  return resolveAddress(await headers());
}
