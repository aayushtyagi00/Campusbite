const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
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
    const captured = id === "pay_Captured";
    return Response.json({ id, order_id: "order_Fixture", status: captured ? "captured" : "authorized",
      captured, currency: "INR", amount: 100, amount_refunded: 0 });
  }
  return new Response(null, { status: 404 });
};
