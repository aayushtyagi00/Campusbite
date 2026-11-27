import { expect, test } from "@playwright/test";
import { proxyAddressResolver } from "../src/lib/proxy-address";

test("only the configured ingress supplies the client address", () => {
  const headers = new Headers({
    "x-vercel-forwarded-for": "192.0.2.1", "x-real-ip": "192.0.2.2",
    "cf-connecting-ip": "192.0.2.3", "x-forwarded-for": "192.0.2.4",
  });
  expect(proxyAddressResolver(false)(headers)).toBeNull();
  expect(proxyAddressResolver(false, "host")(headers)).toBeNull();
  expect(proxyAddressResolver(true, "x-real-ip")(headers)).toBe("192.0.2.1");
  headers.delete("x-vercel-forwarded-for");
  expect(proxyAddressResolver(true, "x-real-ip")(headers)).toBeNull();
  expect(proxyAddressResolver(false, "cf-connecting-ip")(headers)).toBe("192.0.2.3");
  const real = proxyAddressResolver(false, "x-real-ip");
  expect(real(headers)).toBe("192.0.2.2");
  headers.set("x-real-ip", "192.0.2.1, 192.0.2.2");
  expect(real(headers)).toBeNull();
  headers.set("x-real-ip", "2001:0db8:0:0:0:0:0:9");
  expect(real(headers)).toBe("2001:db8::9");
  headers.set("x-real-ip", "::ffff:192.0.2.9");
  expect(real(headers)).toBe("192.0.2.9");
});

test("forwarded chains stop at the nearest untrusted hop", () => {
  const resolve = proxyAddressResolver(false, "x-forwarded-for", "10.0.0.0/8,2001:db8:1::/48");
  const chain = (value: string) => new Headers({ "x-forwarded-for": value });
  expect(resolve(chain("unknown, 192.0.2.5, 10.1.1.1, 2001:db8:1::2"))).toBe("192.0.2.5");
  expect(resolve(chain("192.0.2.5, unknown, 10.1.1.1"))).toBeNull();
  expect(resolve(chain("10.1.1.1"))).toBeNull();
  expect(proxyAddressResolver(false, "x-forwarded-for")(chain("192.0.2.1, 192.0.2.2"))).toBe("192.0.2.2");
  expect(proxyAddressResolver(false, "x-forwarded-for", "10.0.0.1/33")(chain("192.0.2.1"))).toBeNull();
});
