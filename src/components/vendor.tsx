"use client";

import { Bell, Clock3, MapPin, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { categories, clockTime, money, slotLabel, statuses, type Category, type Fulfillment, type Order, type Product, type Stall } from "@/lib/campus";
import { changeOrder, update, useOrderExpiry, usePreview, usePreviewReady, visibleStatus } from "@/lib/preview";
import { Empty, Notice, Status } from "./ui";

export function Vendor({ section }: { section: string }) {
  const data = usePreview();
  const ready = usePreviewReady();
  const [selected, setSelected] = useState("rolling-kitchen");
  const stall = data.stalls.find(item => item.id === selected) ?? data.stalls[0];
  const orders = data.orders.filter(order => order.stall === stall.id);
  const title = { board: "Live order board", menu: "Manage menu", availability: "Availability", onboarding: "Business onboarding", earnings: "Earnings" }[section];
  return <>
    <div className="ops-heading"><div><h1>{title}</h1><p className="row"><MapPin size={16} />{stall.location}</p></div>
      {section !== "onboarding" && <label className="field stall-switch"><span className="sr-only">Preview stall</span><select disabled={!ready} value={stall.id} onChange={event => setSelected(event.target.value)}>{data.stalls.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    </div>
    {section === "board" && <Board orders={orders} stall={stall} />}
    {section === "menu" && <MenuManager key={stall.id} stall={stall} />}
    {section === "availability" && <Availability key={stall.id} stall={stall} />}
    {section === "onboarding" && <Onboarding />}
    {section === "earnings" && <Earnings orders={orders} />}
  </>;
}
const lanes: { label: string; statuses: Fulfillment[] }[] = [
  { label: "Awaiting acceptance", statuses: ["awaiting"] }, { label: "Scheduled", statuses: ["accepted"] },
  { label: "Preparing", statuses: ["preparing"] }, { label: "Ready", statuses: ["ready"] },
  { label: "Closed", statuses: ["collected", "rejected", "expired", "cancelled"] },
];
function Board({ orders, stall }: { orders: Order[]; stall: Stall }) {
  const now = useOrderExpiry();
  const [alert, setAlert] = useState("");
  async function testAlert() {
    try {
      const audio = new AudioContext();
      await audio.resume();
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.frequency.value = 660;
      gain.gain.value = 0.12;
      tone.connect(gain).connect(audio.destination);
      tone.start();
      tone.stop(audio.currentTime + 0.2);
      tone.onended = () => { void audio.close(); };
      setAlert("Test sound played.");
    } catch { setAlert("This browser could not play the test sound."); }
  }
  return <>
    <div className="ops-toolbar panel panel-pad row">
      <Status tone={stall.paused ? "warn" : "good"}>{stall.paused ? "Ordering paused" : "Ordering enabled"}</Status>
      <span className="muted">Preview orders sync across tabs in this browser.</span>
      <button className="button secondary compact push" onClick={testAlert}><Bell size={16} /> Test alert</button>
    </div>
    {alert && <Notice>{alert}</Notice>}
    <div className="board">{lanes.map(lane => {
      const entries = orders.filter(order => lane.statuses.includes(visibleStatus(order, now)));
      return <section className="lane" key={lane.label}><h2>{lane.label} <span>{entries.length}</span></h2>
        {entries.length ? entries.map(order => <VendorOrder key={order.id} order={order} now={now} />) : <p className="lane-empty">No orders</p>}
      </section>;
    })}</div>
  </>;
}
function VendorOrder({ order, now }: { order: Order; now: number }) {
  const [error, setError] = useState("");
  const [reject, setReject] = useState(false);
  const [input, setInput] = useState("");
  const status = visibleStatus(order, now);
  function action(next: Fulfillment) { setError(changeOrder(order.id, next, input) ?? ""); }
  return <article className="panel panel-pad stack board-card">
    <strong>{order.id}</strong>
    <p className="row"><Clock3 size={15} />{slotLabel(order.slot)}</p>
    {order.prepStart && ["awaiting", "accepted"].includes(status) && <p>Start prep by {clockTime(order.prepStart)}</p>}
    <ul>{order.items.map((item, index) => <li key={index}>{item.qty} × {item.name}</li>)}</ul>
    {order.note && <p className="mini-note">{order.note}</p>}
    <details><summary>Order details</summary><p>{money(order.total)} · Demo payment verified</p><p>Received {clockTime(order.placed)}</p>{order.refund !== "None" && <p>Refund · {order.refund}</p>}</details>
    {status === "awaiting" && <>
      <Status tone="warn">{now ? Math.max(0, Math.ceil((order.deadline - now) / 1000)) : 90}s to accept</Status>
      <button className="button full compact" onClick={() => action("accepted")}>Accept order</button>
      {!reject ? <button className="text-link" onClick={() => setReject(true)}>Reject</button> : <form className="stack" onSubmit={event => { event.preventDefault(); action("rejected"); }}>
        <label className="field">Reason<input required maxLength={120} value={input} onChange={event => setInput(event.target.value)} /></label>
        <button className="button secondary compact">Confirm rejection</button>
      </form>}
    </>}
    {status === "accepted" && <button className="button compact" onClick={() => action("preparing")}>Start preparing</button>}
    {status === "preparing" && <button className="button compact" onClick={() => action("ready")}>Mark ready</button>}
    {status === "ready" && <form className="stack" onSubmit={event => { event.preventDefault(); action("collected"); }}>
      <label className="field">Pickup code<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={input} onChange={event => setInput(event.target.value)} /></label>
      <button className="button compact">Verify collection</button>
    </form>}
    {error && <small className="error" role="status">{error}</small>}
  </article>;
}
function MenuManager({ stall }: { stall: Stall }) {
  const data = usePreview();
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const items = data.products.filter(item => item.stall === stall.id && !item.archived);
  const item = editing && editing !== "new" ? editing : undefined;
  const [message, setMessage] = useState("");
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const name = String(values.get("name")).trim();
    if (!name) return;
    const product: Product = {
      id: item?.id ?? crypto.randomUUID(), stall: stall.id, name, category: values.get("category") as Category,
      description: String(values.get("description")).trim(), price: Math.round(Number(values.get("price")) * 100),
      prep: Number(values.get("prep")), diet: String(values.get("diet")).trim(), photo: item?.photo ?? "", soldOut: item?.soldOut ?? false,
    };
    update(current => ({ ...current, products: item ? current.products.map(entry => entry.id === item.id ? product : entry) : [...current.products, product] }));
    setEditing(null);
    setMessage(`${name} saved.`);
  }
  function patch(id: string, values: Partial<Product>) {
    update(current => ({ ...current, products: current.products.map(entry => entry.id === id ? { ...entry, ...values } : entry) }));
  }
  return <div className="stack">
    <div className="row between"><h2>{items.length} menu items</h2><button className="button" onClick={() => setEditing("new")}><Plus size={18} /> Add item</button></div>
    {message && <Notice>{message}</Notice>}
    {editing && <form key={editing === "new" ? editing : editing.id} className="panel panel-pad stack" onSubmit={save}>
      <h2>{item ? "Edit menu item" : "Add menu item"}</h2>
      <div className="form-grid">
        <label className="field">Name<input name="name" required maxLength={80} defaultValue={item?.name} /></label>
        <label className="field">Category<select name="category" defaultValue={item?.category}>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
        <label className="field">Price in rupees<input name="price" required type="number" min="1" max="10000" step="0.01" defaultValue={item && item.price / 100} /></label>
        <label className="field">Prep time (minutes)<input name="prep" required type="number" min="1" max="45" defaultValue={item?.prep ?? 7} /></label>
        <label className="field">Dietary label<input name="diet" required maxLength={60} defaultValue={item?.diet} /></label>
      </div>
      <label className="field">Description and allergens<textarea name="description" required maxLength={300} defaultValue={item?.description} /></label>
      <div className="row"><button className="button">Save item</button><button className="button secondary" type="button" onClick={() => setEditing(null)}>Cancel</button></div>
    </form>}
    {items.map(product => <article className="panel panel-pad row between wrap-row" key={product.id}>
      <div><strong>{product.name}</strong><p>{product.category} · {money(product.price)} · {product.prep} min</p></div>
      <div className="row wrap-row"><Status tone={product.soldOut ? "warn" : "good"}>{product.soldOut ? "Sold out" : "Available"}</Status>
        <button className="button secondary compact" onClick={() => patch(product.id, { soldOut: !product.soldOut })}>{product.soldOut ? "Restock" : "Mark sold out"}</button>
        <button className="text-link" onClick={() => setEditing(product)}>Edit</button>
        <button className="text-link" onClick={() => { if (window.confirm(`Archive ${product.name}?`)) patch(product.id, { archived: true }); }}>Archive</button>
      </div>
    </article>)}
    {!items.length && <Empty title="No menu items" />}
  </div>;
}
function Availability({ stall }: { stall: Stall }) {
  const [message, setMessage] = useState("");
  function patch(values: Partial<Stall>) {
    update(current => ({ ...current, stalls: current.stalls.map(item => item.id === stall.id ? { ...item, ...values } : item) }));
  }
  return <form className="panel panel-pad stack ops-form" onSubmit={event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const opening = String(values.get("opening"));
    const closing = String(values.get("closing"));
    if (opening >= closing) { setMessage("Closing time must be later than opening time."); return; }
    patch({ opening, closing, capacity: Number(values.get("capacity")) });
    setMessage("Pickup settings saved.");
  }}>
    <div className="row between wrap-row"><h2>New orders</h2><button className="button secondary" type="button" onClick={() => patch({ paused: !stall.paused })}>{stall.paused ? "Resume ordering" : "Pause ordering"}</button></div>
    <p>Pausing closes the stall to new orders. Existing orders stay on the board.</p>
    <div className="form-grid">
      <label className="field">Daily opening time<input type="time" name="opening" defaultValue={stall.opening} required /></label>
      <label className="field">Daily closing time<input type="time" name="closing" defaultValue={stall.closing} required /></label>
      <label className="field">Orders per 10-minute window<input type="number" name="capacity" min={1} max={30} defaultValue={stall.capacity} required /></label>
    </div>
    <button className="button">Save pickup settings</button>
    {message && <Notice>{message}</Notice>}
  </form>;
}
function Onboarding() {
  const data = usePreview();
  const saved = data.applications[0];
  const [revising, setRevising] = useState(false);
  const editing = !saved || saved.status === "Draft" || (saved.status === "Changes requested" && revising);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const value = (name: string) => String(values.get(name)).trim();
    const application = { name: value("name"), owner: value("owner"), email: value("email"), location: value("location"), cuisine: value("cuisine"), license: value("license"), status: "Submitted" as const, note: "" };
    if ([application.name, application.owner, application.email, application.location, application.cuisine].some(value => !value)) return;
    update(current => ({ ...current, applications: [application] }));
    setRevising(false);
  }
  return <section className="panel panel-pad stack ops-form">
    <div className="row between"><h2>Stall application</h2><Status>{saved?.status ?? "Draft"}</Status></div>
    <p>Use sample business information in this preview. Payment onboarding and document submission require the backend.</p>
    {saved?.note && <Notice>{saved.note}</Notice>}
    {editing ? <form className="stack" onSubmit={submit}>
      <div className="form-grid">{[
        ["name", "Stall name"], ["owner", "Owner name"], ["email", "Contact email"], ["location", "Exact stall location"], ["cuisine", "Cuisine and description"], ["license", "Registration reference"],
      ].map(([name, label]) => <label className="field" key={name}>{label}<input name={name} type={name === "email" ? "email" : "text"} maxLength={120} required={name !== "license"} defaultValue={saved?.[name as keyof typeof saved]} /></label>)}</div>
      <label className="row"><input type="checkbox" required /> I’m submitting sample details for review.</label>
      <button className="button">Submit for review</button>
    </form> : <><p><strong>{saved?.name}</strong> · {saved?.location}</p>{saved?.status === "Changes requested" && <button className="button" onClick={() => setRevising(true)}>Update application</button>}</>}
  </section>;
}
function Earnings({ orders }: { orders: Order[] }) {
  const total = orders.reduce((sum, order) => sum + order.total, 0);
  const refunded = orders.filter(order => order.refund === "Succeeded").reduce((sum, order) => sum + order.total, 0);
  return <div className="stack">
    <div className="metrics">{[["Simulated gross sales", money(total)], ["Simulated refunds", money(refunded)], ["Provider settlements", "Unavailable"]].map(([label, value]) => <article className="panel panel-pad" key={label}><p>{label}</p><h2>{value}</h2></article>)}</div>
    <Notice>Provider charges, vendor payable amounts and settlement records require payment integration.</Notice>
    {orders.map(order => <div className="panel panel-pad row between wrap-row" key={order.id}><strong>{order.id}</strong><span>{statuses[order.status]}</span><strong>{money(order.total)}</strong></div>)}
  </div>;
}
