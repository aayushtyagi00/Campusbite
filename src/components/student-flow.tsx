"use client";

import { ArrowRight, CalendarClock, Check, Clock3, CreditCard, MapPin, PackageCheck, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { clockTime, dateLabel, money, pickupSlots, slotLabel, statuses } from "@/lib/campus";
import { acknowledgePrices, cartItems, changeOrder, createPreviewOrder, previewTime, update, updateCheckout, useClock, useOrderExpiry, usePreview, visibleStatus } from "@/lib/preview";
import { Quantity } from "./quantity";
import { Back, Empty, Notice, Status } from "./ui";

export function Checkout({ checkout = false }: { checkout?: boolean }) {
  const data = usePreview();
  const router = useRouter();
  const now = previewTime(data, useClock());
  const { start: selected, note } = data.checkout;
  const [error, setError] = useState("");
  const items = cartItems(data);
  const stall = data.stalls.find(item => item.id === items[0]?.stall);
  const unavailable = items.some(item => item.soldOut || item.archived);
  const slots = now && stall && !data.orderingPaused && !unavailable ? pickupSlots(stall, items, data.orders, now) : [];
  const pricesChanged = items.some(item => item.priceChanged);
  const canSubmit = slots.some(slot => slot.start === selected) && !pricesChanged;
  const subtotal = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  if (!stall || !items.length) return <div className="narrow"><h1>Your bag</h1><Empty title="Your bag is empty"><Link className="button" href="/">Browse stalls</Link></Empty></div>;
  return <div className="narrow transaction-page">
    <Back href={checkout ? "/bag" : `/stalls/${stall.id}`}>{checkout ? "Your bag" : stall.name}</Back>
    <div className="page-heading"><h1>{checkout ? "Scheduled checkout" : "Your bag"}</h1><p className="row"><MapPin size={17} />{stall.location}</p></div>
    <div className="transaction-layout">
      <div className="transaction-column">
        <section className="panel panel-pad stack"><h2>{stall.name}</h2>
          {items.map(item => <div className="row between order-line" key={item.id}><div><strong>{checkout && `${item.qty} × `}{item.name}</strong><p>{money(item.price * item.qty)}</p></div>{!checkout && <Quantity product={item} />}</div>)}
        </section>
        {unavailable && <Notice>Some items are no longer available. Remove them from your bag to continue.</Notice>}
        {pricesChanged && <div className="panel panel-pad stack"><Notice>One or more prices changed. Review the new total above before continuing.</Notice><button className="button secondary" onClick={acknowledgePrices}>Accept updated prices</button></div>}
        {checkout &&
          <section className="panel panel-pad stack">
            <h2 className="row"><CalendarClock size={22} /> Pickup window</h2>
            <p>Choose a 10-minute window. Times are shown in IST.</p>
            {slots.length ? <fieldset className="slot-grid"><legend className="sr-only">Available pickup windows</legend>{slots.map(slot =>
              <label className="slot-option" key={slot.start}><input type="radio" name="pickup" checked={selected === slot.start} onChange={() => { updateCheckout({ start: slot.start }); setError(""); }} />{slotLabel(slot)}</label>)}</fieldset> :
              <p className="muted">No pickup windows available for this bag within the next hour.</p>}
            <label className="field">Preparation note (optional)<textarea maxLength={180} value={note} onChange={event => updateCheckout({ note: event.target.value })} placeholder="For example, less spicy" /></label>
          </section>}
      </div>
      <div className="transaction-column transaction-summary">
        {!checkout ? <>
          <div className="panel panel-pad stack bag-totals"><h2>Order summary</h2><div className="row between"><span>Food subtotal</span><strong>{money(subtotal)}</strong></div></div>
          <Link className="button full" href="/checkout">Choose pickup time <ArrowRight size={17} /></Link>
        </> : <>
          <section className="panel panel-pad stack">
            <h2>Price breakdown</h2><div className="row between"><span>Food subtotal</span><span>{money(subtotal)}</span></div>
            <div className="row between"><span>Fees and taxes in preview</span><span>{money(0)}</span></div>
            <div className="row between total"><strong>Total</strong><strong>{money(subtotal)}</strong></div>
            <p>You can cancel while the stall is still deciding whether to accept. Rejected and expired orders request a full refund.</p>
          </section>
          {error && <Notice>{error}</Notice>}
          {data.student ? <button className="button full" disabled={!canSubmit} onClick={() => {
            const result = createPreviewOrder(selected, note);
            if (result.id) router.push(`/orders/${result.id}`);
            else setError(result.error ?? "Try again.");
          }}><CreditCard size={18} /> Simulate payment · {money(subtotal)}</button> :
            <Link className="button full" href="/sign-in?returnTo=checkout">Sign in to continue <ArrowRight size={17} /></Link>}
          <p className="fineprint">Frontend preview. No money is charged. Pickup windows use a sample campus day.</p>
        </>}
      </div>
    </div>
  </div>;
}

export function StudentAccount({ section }: { section: string }) {
  const data = usePreview();
  const router = useRouter();
  const [signup, setSignup] = useState(false);
  const [message, setMessage] = useState("");
  if (section === "recovery") return <Recovery />;
  if (section === "account") return <div className="narrow">
    <div className="page-heading"><h1>Your account</h1><p>Manage your CampusBite preview profile.</p></div>
    {data.student ? <section className="panel panel-pad stack"><h2>{data.student.name}</h2><p>{data.student.email}</p>
      <label className="row"><input type="checkbox" checked={data.notifications} onChange={event => update(current => ({ ...current, notifications: event.target.checked }))} /> Save my order alert preference</label>
      <button className="button secondary" onClick={() => update(current => ({ ...current, student: null }))}>Sign out of preview</button>
    </section> : <section className="panel panel-pad stack">
      <h2>Guest</h2>
      <Link href="/sign-in" className="button">Sign in or register</Link>
    </section>}
    <section className="panel panel-pad stack" aria-label="Account links">
      <Link href="/orders" className="row between account-link">My Orders <ArrowRight size={17} /></Link>
      <Link href="/about" className="row between account-link">About Campus Bite <ArrowRight size={17} /></Link>
    </section>
  </div>;
  function startSession(name: string, email: string) {
    update(current => ({ ...current, student: { name, email: email.toLowerCase() } }));
    router.replace(new URLSearchParams(window.location.search).get("returnTo") === "checkout" ? "/checkout" : "/account");
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim();
    if (!email) return;
    startSession(String(form.get("name") || "Preview student"), email);
  }
  return <div className="narrow auth">
    <Back href="/">Explore</Back><div className="page-heading"><h1>{signup ? "Create your account" : "Sign in to CampusBite"}</h1><p>Your bag stays here while you sign in.</p></div>
    <section className="panel panel-pad stack">
      <Notice>Student preview. Use a sample email and password. Supabase sign-in and email delivery are pending.</Notice>
      <button className="button secondary" onClick={() => setMessage("Google sign-in will become available once Supabase OAuth is configured.")}>Continue with Google</button>
      <form className="stack" onSubmit={submit}>
        {signup && <label className="field">Name<input name="name" autoComplete="off" maxLength={80} required /></label>}
        <label className="field">Email<input type="email" name="email" autoComplete="off" required placeholder="student@example.test" /></label>
        <label className="field">Password<input type="password" name="password" autoComplete="new-password" minLength={8} required /></label>
        <button className="button" type="submit">{signup ? "Create preview account" : "Sign in to preview"}</button>
      </form>
      <button className="button secondary" onClick={() => startSession("Preview student", "student@campusbite.example")}>Use sample student</button>
      {message && <Notice>{message}</Notice>}
      <div className="row between"><Link href="/recovery" className="text-link">Forgot password?</Link><button className="text-link" onClick={() => setSignup(!signup)}>{signup ? "Back to sign in" : "Create account"}</button></div>
    </section>
  </div>;
}

function Recovery() {
  const [step, setStep] = useState<"email" | "code" | "reset" | "done">("email");
  const [sent, setSent] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const now = useClock();
  const cooldown = Math.max(0, 60 - Math.floor((now - sent) / 1000));
  function send() { setSent(Date.now()); setAttempts(0); setError(""); setStep("code"); }
  return <div className="narrow auth"><Back href="/sign-in">Sign in</Back>
    <div className="page-heading"><h1>{step === "reset" ? "Set a new password" : step === "done" ? "Recovery preview complete" : "Reset your password"}</h1><p>Students who usually use Google can return to sign in with Google.</p></div>
    <section className="panel panel-pad stack">
      {step === "email" && <form className="stack" onSubmit={event => { event.preventDefault(); send(); }}>
        <label className="field">Email address<input type="email" value={email} required onChange={event => setEmail(event.target.value)} /></label>
        <button className="button">Preview recovery request</button>
      </form>}
      {step === "code" && <>
        <Notice>If an account exists, it will receive recovery instructions when email delivery is connected. Preview code: 123456.</Notice>
        <form className="stack" onSubmit={event => {
          event.preventDefault();
          if (attempts >= 5) return;
          if (String(new FormData(event.currentTarget).get("code")) === "123456") { setStep("reset"); setError(""); }
          else { setAttempts(attempts + 1); setError(attempts === 4 ? "Attempt limit reached. Request a new code." : "That code did not match."); }
        }}>
          <label className="field">Recovery code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label>
          <button className="button" disabled={attempts >= 5}>Verify preview code</button>
        </form>
        <button className="button secondary" disabled={cooldown > 0} onClick={send}>{cooldown ? `Resend in ${cooldown}s` : "Resend preview code"}</button>
        <button className="text-link" disabled={attempts >= 5} onClick={() => { setError(""); setStep("reset"); }}>Preview emailed recovery link</button>
      </>}
      {step === "reset" && <form className="stack" onSubmit={event => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        if (values.get("password") !== values.get("confirm")) { setError("Passwords must match."); return; }
        setError(""); setStep("done");
      }}>
        <label className="field">New sample password<input name="password" type="password" minLength={8} autoComplete="new-password" required /></label>
        <label className="field">Confirm sample password<input name="confirm" type="password" minLength={8} autoComplete="new-password" required /></label>
        <button className="button">Complete recovery preview</button>
      </form>}
      {step === "done" && <><p>The preview recovery flow is complete. Account passwords remain managed through Supabase once connected.</p><Link className="button" href="/sign-in">Return to sign in</Link></>}
      {error && <Notice>{error}</Notice>}
    </section>
  </div>;
}

export function StudentOrders({ id }: { id?: string }) {
  const data = usePreview();
  const now = useOrderExpiry();
  const [error, setError] = useState("");
  const orders = data.orders.filter(order => order.student === data.student?.email);
  const order = orders.find(item => item.id === id);
  if (!data.student) return <div className="narrow"><h1>Your orders</h1><Empty title="Sign in to see your orders"><Link className="button" href="/sign-in">Sign in</Link></Empty></div>;
  if (!id) return <div className="narrow order-history"><div className="page-heading"><h1>Your orders</h1><p>Track pickups and refund requests.</p></div>
    {!orders.length && <Empty title="No orders yet"><Link className="button" href="/">Explore campus stalls</Link></Empty>}
    <div className="stack order-history-grid">{orders.map(item => <Link className="panel panel-pad stack order-card" key={item.id} href={`/orders/${item.id}`}>
      <div className="row between"><strong>{item.name}</strong><Status tone="good">{statuses[visibleStatus(item, now)]}</Status></div>
      <div className="row between"><span>{item.id} · {dateLabel(item.placed)}</span><strong>{money(item.total)}</strong></div>
    </Link>)}</div></div>;
  if (!order) return <div className="narrow"><Empty title="Order unavailable"><Link className="button" href="/orders">View orders</Link></Empty></div>;
  const status = visibleStatus(order, now);
  const seconds = now ? Math.max(0, Math.ceil((order.deadline - now) / 1000)) : 90;
  const refund = status === "expired" && order.refund === "None" ? "Requested" : order.refund;
  return <div className="narrow transaction-page"><Back href="/orders">Your orders</Back>
    <div className="page-heading"><p className="eyebrow">{order.id}</p><h1>{statuses[status]}</h1><p>{order.name}</p></div>
    <div className="transaction-layout">
      <div className="transaction-column">
        <section className={`panel panel-pad stack ${status === "ready" ? "ready-panel" : ""}`}>
          <h2 className="row"><MapPin size={21} />{order.location}</h2>
          <p className="row"><Clock3 size={18} />{dateLabel(order.slot.start)} · {slotLabel(order.slot)} IST</p>
          {status === "awaiting" && <><p>Preview payment verified. The stall has <strong>{seconds}s</strong> to accept your order.</p>
            <button className="button secondary" onClick={() => {
              if (window.confirm("Cancel this order and request a full preview refund?")) setError(changeOrder(order.id, "cancelled") ?? "");
            }}>Cancel order</button></>}
          {status === "ready" && <div className="pickup-code"><PackageCheck size={26} /><strong>{order.code}</strong><p>Show this six-digit code at the stall.</p></div>}
          {status === "accepted" && <p>The stall has accepted your order. Check back for preparation updates.</p>}
          {status === "preparing" && <p>The stall is preparing your meal.</p>}
          {status === "collected" && <p className="row"><Check size={18} /> Pickup complete</p>}
          {error && <Notice>{error}</Notice>}
        </section>
        <section className="panel panel-pad stack"><h2>Order details</h2>{order.items.map((item, index) => <div className="row between" key={index}><span>{item.qty} × {item.name}</span><strong>{money(item.price * item.qty)}</strong></div>)}
          {order.note && <p>Preparation note · {order.note}</p>}
          <div className="row between total"><strong>Total</strong><strong>{money(order.total)}</strong></div>
          <p className="row"><ShieldCheck size={18} /> Payment · {order.payment} in preview</p>
          {refund !== "None" && <p>Refund · {refund} · {money(order.total)}</p>}
        </section>
      </div>
      <div className="transaction-column">
        <section className="panel panel-pad stack"><h2>Activity</h2>{order.events.map((event, index) => <div className="row between" key={index}><span>{event.status}</span><time>{clockTime(event.at)}</time></div>)}</section>
        <SupportForm key={order.id} id={order.id} />
      </div>
    </div>
  </div>;
}

function SupportForm({ id }: { id: string }) {
  const data = usePreview();
  const support = data.support.find(item => item.order === id);
  const [issue, setIssue] = useState("");
  return <section className="panel panel-pad stack">
    <h2>Order support</h2>
    {support ? <><Status tone={support.resolution ? "good" : "warn"}>{support.resolution ? "Resolved" : "Submitted in preview"}</Status><p>{support.issue}</p>{support.resolution && <p>{support.resolution}</p>}</> :
      <form className="stack" onSubmit={event => {
        event.preventDefault();
        if (!issue.trim()) return;
        update(current => current.support.some(item => item.order === id) ? current :
          { ...current, support: [...current.support, { order: id, issue: issue.trim(), resolution: "" }] });
      }}>
        <label className="field">What happened?<textarea value={issue} onChange={event => setIssue(event.target.value)} placeholder="For example, a missing item" maxLength={300} required /></label>
        <button className="button secondary">Submit sample support request</button>
      </form>}
  </section>;
}
