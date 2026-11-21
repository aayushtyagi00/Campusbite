"use client";

import { ArrowLeft, ArrowRight, CalendarClock, Check, Clock3, CreditCard, MapPin, PackageCheck, ShieldCheck } from "lucide-react";
import Link from "next/link";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { clockTime, dateLabel, money, pickupSlots, slotLabel, statuses } from "@/lib/campus";
import { acknowledgePrices, removeMissingCartItems, cartItems, clearPreviewCheckout, previewTime, updateCheckout, useClock, usePreview, visibleStatus } from "@/lib/preview";
import { confirmLiveCheckout, startLiveCheckout, updateLiveStudentOrder } from "@/lib/commerce-actions";
import { selectedStudentOrder, selectStudentOrder, type StudentOrder, type StudentOrderHistory } from "@/lib/student-order-types";
import { usePickupAvailability } from "./use-pickup-availability";
import { Quantity } from "./quantity";
import { Back, Empty, Notice, Status } from "./ui";

type PaymentResponse = { razorpay_payment_id: string; razorpay_signature: string };
type RazorpayCheckout = new (options: {
  key: string; order_id: string; amount: number; currency: string; name: string;
  handler: (payment: PaymentResponse) => void; modal: { ondismiss: () => void };
}) => { open: () => void };
const liveCheckoutKey = "campusbite.checkout.request";

function savedCheckoutRequest(basket: string) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(liveCheckoutKey) ?? "null");
    if (saved?.basket === basket && typeof saved.id === "string") return saved.id as string;
  } catch { /* Checkout remains usable without tab storage. */ }
  return null;
}

function liveCheckoutRequest(basket: string) {
  const saved = savedCheckoutRequest(basket);
  if (saved) return saved;
  const id = crypto.randomUUID();
  try { sessionStorage.setItem(liveCheckoutKey, JSON.stringify({ basket, id })); } catch { /* Use the in-memory request. */ }
  return id;
}

function clearLiveCheckoutRequest() {
  try { sessionStorage.removeItem(liveCheckoutKey); } catch { /* The tab has no storage. */ }
}

export function Checkout({ checkout = false, history }: { checkout?: boolean; history?: StudentOrderHistory }) {
  const data = usePreview();
  const router = useRouter();
  const clock = useClock();
  const live = Boolean(data.live);
  const now = live ? clock : previewTime(data, clock);
  const { start: selected, note } = data.checkout;
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [gatewayReady, setGatewayReady] = useState(false);
  const [refresh,setRefresh] = useState(0);
  const [resume,setResume] = useState<{basket:string;id:string} | null>(null);
  const items = cartItems(data);
  const stall = data.stalls.find(item => item.id === items[0]?.stall);
  const unavailable = items.some(item => item.soldOut || item.archived);
  const basket = JSON.stringify({lines:data.cart,selected,note,minutes:stall?.pickupMinutes ?? 10});
  useEffect(()=>{
    const id = savedCheckoutRequest(basket);
    setResume(id ? {basket,id} : null);
  },[basket]);
  const query = checkout && live && stall && items.length ? JSON.stringify({stall:stall.id,
    items:items.map(item=>({id:item.id,qty:item.qty,price:item.price})),requestId:resume?.basket===basket ? resume.id : null}) : null;
  const quote = usePickupAvailability(query,refresh);
  const slots = live ? (quote && clock-quote.received<20000 ? quote.slots.filter(slot=>slot.start>clock) : []) :
    now && stall && !data.orderingPaused && !unavailable ? pickupSlots(stall,items,history?.orders ?? [],now,clock) : [];
  const chosen = slots.find(slot=>slot.start===selected);
  const pricesChanged = items.some(item => item.priceChanged);
  const missingItems = data.products.length>0 && data.cart.length > items.length;
  const unavailableNotice = missingItems && <div className="panel panel-pad stack"><Notice>An item in your bag has been removed from the menu.</Notice><button className="button secondary" onClick={()=>removeMissingCartItems(data.products)}>Remove unavailable items</button></div>;
  const canSubmit = !missingItems && !!chosen && !unavailable && !pricesChanged;
  const subtotal = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  if (!stall || !items.length) return <div className="narrow"><h1>Your bag</h1>{unavailableNotice}<Empty title="Your bag is empty"><Link className="button" href="/">Browse stalls</Link></Empty></div>;
  function openOrder(id: string) {
    selectStudentOrder(id);
    clearLiveCheckoutRequest();
    clearPreviewCheckout();
    router.push("/orders");
  }
  return <div className="narrow transaction-page">
    {live && history?.signedIn && <Script src="https://checkout.razorpay.com/v1/checkout.js" onReady={() => setGatewayReady(true)}
      onError={() => setError("Could not load the payment form. Reload checkout to retry.")} />}
    <Back href={checkout ? "/bag" : `/stalls/${stall.id}`}>{checkout ? "Your bag" : stall.name}</Back>
    <div className="page-heading"><h1>{checkout ? "Scheduled checkout" : "Your bag"}</h1><p className="row"><MapPin size={17} />{stall.location}</p></div>
    <div className="transaction-layout">
      <div className="transaction-column">
        <section className="panel panel-pad stack"><h2>{stall.name}</h2>
          {items.map(item => <div className="row between order-line" key={item.id}><div><strong>{checkout && `${item.qty} × `}{item.name}</strong><p>{money(item.price * item.qty)}</p></div>{!checkout && <Quantity product={item} />}</div>)}
        </section>
        {unavailableNotice}
        {unavailable && <Notice>Some items are no longer available. Remove them from your bag to continue.</Notice>}
        {pricesChanged && <div className="panel panel-pad stack"><Notice>One or more prices changed. Review the new total above before continuing.</Notice><button className="button secondary" onClick={() => acknowledgePrices(data.products)}>Accept updated prices</button></div>}
        {checkout &&
          <section className="panel panel-pad stack">
            <h2 className="row"><CalendarClock size={22} /> Pickup window</h2>
            <p>Choose a pickup window. Times are shown in IST.</p>
            {live && <button className="text-link" type="button" onClick={()=>setRefresh(n=>n+1)}>Refresh availability</button>}
            {slots.length ? <fieldset className="slot-grid"><legend className="sr-only">Available pickup windows</legend>{slots.map(slot =>
              <label className="slot-option" key={slot.start}><input type="radio" name="pickup" checked={selected === slot.start} onChange={() => { updateCheckout({ start: slot.start }); setError(""); }} />{slotLabel(slot)}</label>)}</fieldset> :
              <p className="muted">{live && !quote ? "Checking pickup availability…" : quote?.message || "No pickup windows available for this bag within the next hour."}</p>}
            <label className="field">Preparation note (optional)<textarea maxLength={180} value={note} onChange={event => { updateCheckout({ note: event.target.value }); }} placeholder="For example, less spicy" /></label>
          </section>}
      </div>
      <div className="transaction-column transaction-summary">
        {!checkout ? <>
          <div className="panel panel-pad stack bag-totals"><h2>Order summary</h2><div className="row between"><span>Food subtotal</span><strong>{money(subtotal)}</strong></div></div>
          <Link className="button full" href="/checkout">Choose pickup time <ArrowRight size={17} /></Link>
        </> : <>
          <section className="panel panel-pad stack">
            <h2>Price breakdown</h2><div className="row between"><span>Food subtotal</span><span>{money(subtotal)}</span></div>
            <div className="row between total"><strong>Total</strong><strong>{money(subtotal)}</strong></div>
            <p>You can cancel while the stall is still deciding whether to accept. Rejected and expired orders request a full refund.</p>
          </section>
          {error && <Notice>{error}</Notice>}
          {history?.unavailable ? <Notice>Orders are temporarily unavailable.</Notice> :
            history?.signedIn && !live ? <Notice>Online payment is currently unavailable.</Notice> :
            history?.signedIn ? <button className="button full" disabled={!canSubmit || pending || !gatewayReady} onClick={async () => {
              setPending(true);
              setError("");
              try {
                if (!chosen) return;
                const requestId = resume?.basket===basket ? resume.id : liveCheckoutRequest(basket);
                setResume({basket,id:requestId});
                const result = await startLiveCheckout(data.cart, selected, note, requestId,(chosen.end-chosen.start)/60000);
                if (result.signIn) router.push("/sign-in?returnTo=checkout");
                else if (result.id) {
                  const id = result.id;
                  const gateway = result.gateway;
                  if (!gateway) openOrder(id);
                  else {
                    const Razorpay = (window as Window & { Razorpay?: RazorpayCheckout }).Razorpay;
                    if (!Razorpay) throw new Error("Payment checkout unavailable");
                    await new Promise<void>((resolve, reject) => {
                      const checkout = new Razorpay({ key: gateway.key, order_id: gateway.order, amount: gateway.amount,
                        currency: "INR", name: "CampusBite", modal: { ondismiss: resolve },
                        handler: response => {
                          void confirmLiveCheckout(id, response.razorpay_payment_id, response.razorpay_signature)
                            .finally(() => { openOrder(id); resolve(); }).catch(reject);
                        },
                      });
                      checkout.open();
                    });
                  }
                } else {
                  if (!result.error?.includes("same checkout")) {
                    setResume(null);
                    clearLiveCheckoutRequest();
                  }
                  setError(result.error ?? "Try again.");
                }
              } catch { setError("Checkout is temporarily unavailable. Please try again."); }
              finally { setPending(false); setRefresh(n=>n+1); }
            }}><CreditCard size={18} /> {pending ? "Opening checkout…" : `Pay · ${money(subtotal)}`}</button> :
            <Link className="button full" href="/sign-in?returnTo=checkout">Sign in to continue <ArrowRight size={17} /></Link>}
        </>}
      </div>
    </div>
  </div>;
}

export function StudentOrders({ history }: { history: StudentOrderHistory }) {
  const now = useClock();
  const router = useRouter();
  const previous = useRef<StudentOrder[]>([]);
  const [alerts, setAlerts] = useState<string[]>([]);
  const { orders, preferences } = history;
  const active = orders.some(order => ["unpaid", "awaiting", "accepted", "preparing", "ready"].includes(order.status)
    || ["Requested", "Pending"].includes(order.refund));
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => { if (!document.hidden) router.refresh(); }, 10000);
    return () => window.clearInterval(timer);
  }, [active, router]);
  useEffect(() => {
    const updates: string[] = [];
    for (const order of orders) {
      const prior = previous.current.find(item => item.id === order.id);
      if (!prior) continue;
      if (preferences?.orderAlerts && prior.status !== order.status && order.status !== "unpaid")
        updates.push(displayReference(order.id) + " · " + statuses[order.status]);
      if (preferences?.refundAlerts && prior.refund !== order.refund)
        updates.push(displayReference(order.id) + " · Refund " + order.refund.toLowerCase());
    }
    previous.current = orders;
    if (updates.length) setAlerts(updates);
  }, [orders, preferences]);
  const notices = alerts.length > 0 && <div className="panel panel-pad" role="status">
    {alerts.map(message => <p key={message}>{message}</p>)}<button className="text-link" onClick={() => setAlerts([])}>Dismiss alerts</button></div>;
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { setId(selectedStudentOrder()); }, []);
  function select(next: string | null) {
    selectStudentOrder(next);
    setId(next);
  }
  if (history.unavailable) return <div className="narrow"><h1>Your orders</h1><Notice>Orders are temporarily unavailable.</Notice></div>;
  if (!history.signedIn) return <div className="narrow"><h1>Your orders</h1><Empty title="Sign in to see your orders"><Link className="button" href="/sign-in">Sign in</Link></Empty></div>;
  const order = orders.find(item => item.id === id);
  if (!order) return <div className="narrow order-history"><div className="page-heading"><h1>Your orders</h1><p>Track pickups and refund requests.</p></div>
    {notices}{!orders.length && <Empty title="No orders yet"><Link className="button" href="/">Explore campus stalls</Link></Empty>}
    <div className="stack order-history-grid">{orders.map(item => <button type="button" className="panel panel-pad stack order-card" key={item.id} onClick={() => select(item.id)}>
      <div className="row between"><strong>{item.name}</strong><Status tone="good">{item.status === "unpaid" ? "Payment pending" : statuses[visibleStatus({ status: item.status, deadline: item.deadline }, now)]}</Status></div>
      <div className="row between"><span>{displayReference(item.id)} · {dateLabel(item.placed)}</span><strong>{money(item.total)}</strong></div>
    </button>)}</div></div>;
  return <>{notices}<StudentOrderDetails key={order.id} order={order} now={now} close={() => select(null)} /></>;
}

function displayReference(id: string) {
  return "CB-" + id.slice(0, 8).toUpperCase();
}

function StudentOrderDetails({ order, now, close }: { order: StudentOrder; now: number; close: () => void }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const status = order.status === "unpaid" ? "unpaid" : visibleStatus({ status: order.status, deadline: order.deadline }, now);
  const seconds = now ? Math.max(0, Math.ceil((order.deadline - now) / 1000)) : 90;
  const refund = status === "expired" && order.payment === "Verified" && order.refund === "None" ? "Requested" : order.refund;
  return <div className="narrow transaction-page"><button type="button" className="back" onClick={close}><ArrowLeft size={17} /> Your orders</button>
    <div className="page-heading"><p className="eyebrow">{displayReference(order.id)}</p><h1>{status === "unpaid" ? "Payment pending" : statuses[status]}</h1><p>{order.name}</p></div>
    <div className="transaction-layout">
      <div className="transaction-column">
        <section className={`panel panel-pad stack ${status === "ready" ? "ready-panel" : ""}`}>
          <h2 className="row"><MapPin size={21} />{order.location}</h2>
          <p className="row"><Clock3 size={18} />{dateLabel(order.slot.start)} · {slotLabel(order.slot)} IST</p>
          {status === "unpaid" && <p>Waiting for payment confirmation from Razorpay.</p>}
          {status === "awaiting" && <><p>Payment verified. The stall has <strong>{seconds}s</strong> to accept your order.</p>
            <button className="button secondary" disabled={cancelling} onClick={async () => {
              if (!window.confirm("Cancel this order and request a full refund?")) return;
              setCancelling(true);
              try {
                const result = await updateLiveStudentOrder(order.id);
                setError(result.error ?? "");
                router.refresh();
              } catch { setError("This order could not be cancelled."); }
              finally { setCancelling(false); }
            }}>Cancel order</button></>}
          {status === "ready" && <div className="pickup-code"><PackageCheck size={26} /><strong>{order.code}</strong><p>Show this six-digit code at the stall.</p></div>}
          {status === "rejected" && order.rejection_reason && <p>Reason from the stall · {order.rejection_reason}</p>}
          {status === "accepted" && <p>The stall has accepted your order. Check back for preparation updates.</p>}
          {status === "preparing" && <p>The stall is preparing your meal.</p>}
          {status === "collected" && <p className="row"><Check size={18} /> Pickup complete</p>}
          {error && <Notice>{error}</Notice>}
        </section>
        <section className="panel panel-pad stack"><h2>Order details</h2>{order.items.map((item, index) => <div className="row between" key={index}><span>{item.qty} × {item.name}</span><strong>{money(item.price * item.qty)}</strong></div>)}
          {order.note && <p>Preparation note · {order.note}</p>}
          <div className="row between total"><strong>Total</strong><strong>{money(order.total)}</strong></div>
          <p className="row"><ShieldCheck size={18} /> Payment · {order.payment}</p>
          {refund !== "None" && <p>Refund · {refund} · {money(order.total)}</p>}
        </section>
      </div>
      <div className="transaction-column">
        <section className="panel panel-pad stack"><h2>Activity</h2>{order.events.map((event, index) => <div className="row between" key={index}><span>{event.status}</span><time>{clockTime(event.at)}</time></div>)}</section>
        <SupportForm id={order.id} support={order.support} />
      </div>
    </div>
  </div>;
}

function SupportForm({ id, support }: { id: string; support?: string }) {
  const router = useRouter();
  const [issue, setIssue] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  return <section className="panel panel-pad stack">
    <h2>Order support</h2>
    {support ? <><Status tone="warn">Submitted</Status><p>{support}</p></> :
      <form className="stack" onSubmit={async event => {
        event.preventDefault();
        if (!issue.trim()) return;
        setPending(true);
        try {
          const result = await updateLiveStudentOrder(id, issue);
          setError(result.error ?? "");
          if (!result.error) router.refresh();
        } catch { setError("Your support note could not be saved."); }
        finally { setPending(false); }
      }}>
        <label className="field">What happened?<textarea value={issue} onChange={event => setIssue(event.target.value)} placeholder="For example, a missing item" maxLength={300} required /></label>
        {error && <Notice>{error}</Notice>}
        <button className="button secondary" disabled={pending}>Submit support request</button>
      </form>}
  </section>;
}
