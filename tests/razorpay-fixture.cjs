const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.href === "https://openidconnect.googleapis.com/v1/userinfo") {
    const token = new Request(input, init).headers.get("authorization");
    if (token === "Bearer google-owner-fixture")
      return Response.json({ sub: "owner-sub", email: "tyagiaayush3030@gmail.com", email_verified: true });
    if (token === "Bearer google-other-fixture")
      return Response.json({ sub: "other-sub", email: "other@example.test", email_verified: true });
    return new Response(null, { status: 401 });
  }
  if (url.href === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
    const body = await new Request(input, init).formData();
    const token = body.get("response");
    const action = token === "signup-fixture" ? "student-signup" : "public-review";
    const hostname = token === "other-host-fixture" ? "other.example.test" : "campusbite-lpu.vercel.app";
    return Response.json({ success: ["signup-fixture","review-fixture","other-host-fixture"].includes(token), action, hostname });
  }
  if (url.hostname !== "api.razorpay.com") return originalFetch(input, init);
  const req = new Request(input, init);
  if (req.method === "POST" && url.pathname === "/v1/orders") {
    return Response.json({ ...await req.json(), id: "order_Fixture" });
  }
  if (req.method === "GET" && url.pathname === "/v1/orders/order_Fixture/payments") {
    return Response.json({items:[{id:"pay_Recovered",order_id:"order_Fixture",amount:100,currency:"INR",status:"captured",captured:true,amount_refunded:0,created_at:1600000000}]});
  }
  if (req.method === "GET" && url.pathname.startsWith("/v1/payments/pay_")) {
    const id = url.pathname.split("/").pop();
    if (id === "pay_AuthorizedTea" || id === "pay_CapturedTea") {
      const captured = id === "pay_CapturedTea";
      return Response.json({ id, order_id: "order_Fixture", amount: 3000, currency: "INR",
        status: captured ? "captured" : "authorized", captured, amount_refunded: 0 });
    }
    if (id === "pay_Split" || id === "pay_Partial") {
      const full = id === "pay_Split";
      return Response.json({ id, order_id: "order_Fixture", captured: true, amount: 100, currency: "INR",
        status: full ? "refunded" : "captured", amount_refunded: full ? 100 : 40, refund_status: full ? "full" : "partial" });
    }
    const captured = id === "pay_Captured";
    return Response.json({ id, order_id: "order_Fixture", status: captured ? "captured" : "authorized",
      captured, currency: "INR", amount: 100, amount_refunded: 0 });
  }
  if (req.method === "GET" && ["/v1/refunds/rfnd_Split", "/v1/refunds/rfnd_Partial"].includes(url.pathname)) {
    const id = url.pathname.split("/").pop();
    return Response.json({ id, payment_id: id.replace("rfnd_", "pay_"), status: "processed", currency: "INR", amount: 40 });
  }
  return new Response(null, { status: 404 });
};
