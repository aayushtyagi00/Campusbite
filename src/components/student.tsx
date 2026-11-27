"use client";

import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, Clock3, MapPin, Search, ShoppingBag, Utensils, Zap } from "lucide-react";
import { useState } from "react";
import { hoursOn, weekdays, defaultFoodCourt, foodCourts, isOrderable, money, pickupSlots, slotLabel, stallsAtCourt, type Product, type Stall } from "@/lib/campus";
import { cartItems, previewTime, update, useClock, usePreview, usePreviewReady } from "@/lib/preview";
import { Back, Empty, Photo, Status } from "./ui";
import { Checkout, StudentOrders } from "./student-flow";
import type { StudentOrderHistory } from "@/lib/student-order-types";
import { Quantity } from "./quantity";
import { CampusReviews } from "./campus-reviews";
import { usePickupAvailability } from "./use-pickup-availability";
import { HomeGuide } from "./home-guide";

export function StudentPage({ section, id, history, siteKey }: { section: string; id?: string; history?: StudentOrderHistory; siteKey?: string }) {
  switch (section) {
    case "about": return <About />;
    case "stalls": return <Menu key={id} id={id} />;
    case "products": return <ProductDetail key={id} id={id} />;
    case "bag": return <Checkout />;
    case "checkout": return <Checkout checkout history={history} />;
    case "orders": return <StudentOrders history={history ?? { signedIn: false, orders: [] }} />;
    default: return <Explore key={section} section={section} siteKey={siteKey} />;
  }
}

function Explore({ section, siteKey }: { section: string; siteKey?: string }) {
  const data = usePreview();
  const now = previewTime(data, useClock());
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const home = section === "home";
  const court = section === "court";
  const selectedCourt = (data.courts ?? foodCourts).find(item => item.id === data.foodCourt) ?? foodCourts[0];
  const courtVendors = stallsAtCourt(data.stalls, selectedCourt.id);
  const availableCategories = [...new Set(data.products.filter(item => !item.archived && courtVendors.some(shop=>shop.id===item.stall)).map(item=>item.category))].sort();
  const selectedCategory = availableCategories.includes(category) ? category : "All";
  const needle = query.trim().toLowerCase();
  const vendors = courtVendors.filter(stall => {
    const menu = data.products.filter(item => item.stall === stall.id && !item.archived);
    const matchesStall = `${stall.name} ${stall.cuisine} ${stall.location}`.toLowerCase().includes(needle);
    return menu.some(item => (selectedCategory === "All" || item.category === selectedCategory) && (matchesStall || item.name.toLowerCase().includes(needle)))
      || (selectedCategory === "All" && matchesStall);
  });
  return <>
    {home ?
      <section className="hero">
        <div className="mobile-hero-copy">
          <span className="hero-chip"><span /> {selectedCourt.name}{selectedCourt.id === defaultFoodCourt ? " Food Court" : ""}{courtVendors.length > 0 && ` · ${courtVendors.length} stalls`}</span>
          <h1>Your break.<br /><em>Made delicious.</em></h1>
          <p>Order ahead. Pick up fresh between classes.</p>
        </div>
        <div className="hero-copy">
          <span className="hero-chip"><span /> Campus pickup at LPU</span>
          <h1>Campus food.<br /><em>Less waiting.</em></h1>
          <p>Order ahead from LPU’s cafés and food stalls, then pick up your meal between classes.</p>
          <div className="hero-actions"><Link className="button" href="/order-online">Order Online <ArrowRight size={17} /></Link>
            <a className="button secondary" href="#campus-vendors">Explore vendors</a></div>
        </div>
        <VendorSlider key={selectedCourt.id} vendors={courtVendors} court={selectedCourt.name} />
      </section> :
      <section className="page-heading order-intro">
        <span className="eyebrow"><MapPin size={15} /> {selectedCourt.name} · Lovely Professional University</span>
        <h1>{court ? "Campus Food Courts" : "Order Online"}</h1>
        <p>Choose a café or food vendor to see its menu, then select a pickup time at checkout.</p>
      </section>}
    {data.orderingPaused && <p className="notice" role="status">Campus ordering is paused. You can still browse the menus.</p>}
    <div className="explore-layout" id="campus-vendors">
      <div className="discover">
        <label className="search"><Search size={23} /><input type="search" placeholder="Find a stall or a dish" aria-label="Find a stall or a dish" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <h2 className="filter-heading">Categories</h2>
        <div className="chips" aria-label="Filter by category">
          {["All", ...availableCategories].map(item => <button key={item} aria-pressed={selectedCategory === item} onClick={() => setCategory(item)}>{item}</button>)}
        </div>
      </div>
      <div className="explore-results">
        <div className="section-head"><div><h2>{home ? "Campus cafés & food vendors" : "Choose a vendor"} <span>({vendors.length})</span></h2><p>{home ? `Browse pickup options at ${selectedCourt.name}.` : "Select a vendor to view its menu."}</p></div></div>
        <div className="stall-grid">{vendors.map(stall => <StallCard key={stall.id} stall={stall} now={now} />)}</div>
        {!courtVendors.length ? <Empty title="No vendors listed at this food court yet">
          {data.stalls.length > 0 && <p>Choose another food court to browse available vendors.</p>}
          {selectedCourt.id !== defaultFoodCourt && stallsAtCourt(data.stalls, defaultFoodCourt).length > 0 && <button className="button secondary" onClick={() => update(current => ({ ...current, foodCourt: defaultFoodCourt }))}>Show UniMall vendors</button>}
        </Empty> : !vendors.length && <Empty title="No stalls found"><p>Try a different dish or category.</p><button className="button secondary" onClick={() => { setQuery(""); setCategory("All"); }}>Clear filters</button></Empty>}
      </div>
    </div>
    {home && <>
      <div className="desktop-home-guide"><HomeGuide court={selectedCourt.name} vendors={courtVendors} products={data.products} /></div>
      <CampusReviews siteKey={siteKey} />
    </>}
  </>;
}

function VendorSlider({ vendors, court }: { vendors: Stall[]; court: string }) {
  const [position, setPosition] = useState(0);
  const ready = usePreviewReady();
  if (!vendors.length) return null;
  const active = vendors[position % vendors.length];
  const move = (step: number) => setPosition(current => (current + vendors.length + step) % vendors.length);
  return <section className="hero-feature" aria-label="Featured campus vendors">
    <Photo name={active.photo} key={active.id} />
    <div className="hero-feature-caption">
      <div aria-live="polite">
        <p className="row"><MapPin size={15} />{court}</p>
        <strong>{active.name}</strong>
      </div>
      {vendors.length > 1 && <div className="hero-feature-controls">
        <button type="button" aria-label="Previous vendor" onClick={() => move(-1)} disabled={!ready}><ChevronLeft size={20} /></button>
        <button type="button" aria-label="Next vendor" onClick={() => move(1)} disabled={!ready}><ChevronRight size={20} /></button>
      </div>}
    </div>
  </section>;
}

function About() {
  return <article className="about-page">
    <header className="about-intro">
      <div>
        <h1>About CampusBite</h1>
        <h2>More time for your break.</h2>
        <p>CampusBite connects LPU students with campus cafés, food stalls, and shops. Our goal is to save you time between classes by helping you find what’s available, order ahead, and pick up at your chosen time.</p>
        <Link className="button" href="/order-online">Browse campus vendors <ArrowRight size={17} /></Link>
      </div>
      <Photo name="punjab" />
    </header>
    <section className="panel panel-pad stack">
      <h2>How we save you time</h2>
      <p>Choose a vendor, browse its menu, and select a pickup window at checkout. You can track your order and head to the stall once it’s ready, so you spend less of your break standing in line.</p>
    </section>
    <section className="panel panel-pad stack">
      <h2>How CampusBite started</h2>
      <p>CampusBite was started by a first-year B.Tech Computer Science and Engineering student who wanted to make campus food easier to fit between classes.</p>
    </section>
  </article>;
}
function StallCard({ stall, now }: { stall: Stall; now: number }) {
  const data = usePreview();
  const menu = data.products.filter(item => item.stall === stall.id && !item.archived && !item.soldOut);
  const fastest = menu.reduce<Product | undefined>((item, candidate) => !item || candidate.prep < item.prep ? candidate : item, undefined);
  const quote = usePickupAvailability(data.live && fastest && !stall.paused ? JSON.stringify({stall:stall.id,items:[{id:fastest.id,qty:1,price:fastest.price}]}) : null,0);
  const firstSlot = data.live ? quote?.slots.find(slot => slot.start > now) : now && fastest && !data.orderingPaused ? pickupSlots(stall, [{ prep: fastest.prep, qty: 1 }], data.orders, now)[0] : undefined;
  const price = menu.length ? Math.min(...menu.map(item => item.price)) : null;
  return <Link className="stall-card" href={`/stalls/${stall.id}`}>
    <div className="stall-image"><Photo name={stall.photo} /><span className="stall-location">{stall.location.split(" · ")[0]}</span>
      <Status tone={firstSlot ? "good" : ""}>{firstSlot ? "Pickup available" : "Browse menu"}</Status></div>
    <div className="stall-body">
      <div className="row between"><h3>{stall.name}</h3>{price !== null && <strong className="from">From {money(price)}</strong>}</div>
      <p>{stall.cuisine}</p>
      <div className="pickup-label"><Zap size={17} /> {firstSlot ? `Pickup from ${slotLabel(firstSlot)}` : "See stall hours"} <ArrowRight size={16} className="push" /></div>
      <p className="food-list"><Utensils size={15} /> {menu.slice(0, 2).map(item => item.name).join(", ") || "Menu updates coming soon"}</p>
    </div>
  </Link>;
}
function Menu({ id }: { id?: string }) {
  const data = usePreview();
  const [category, setCategory] = useState("All");
  const stall = data.stalls.find(item => item.id === id && item.approval === "Approved");
  if (!stall) return <Empty title="Stall unavailable"><Link className="button" href="/order-online">Choose another vendor</Link></Empty>;
  const menu = data.products.filter(item => item.stall === stall.id && !item.archived);
  const groups = [...new Set(menu.map(item => item.category))].sort();
  const selectedCategory = groups.includes(category) ? category : "All";
  return <>
    <Back href="/order-online">Choose a vendor</Back>
    <section className="menu-intro panel">
      <Photo name={stall.photo} />
      <div><p className="eyebrow">{stall.cuisine}</p><h1>{stall.name}</h1>
        <p className="row"><MapPin size={18} />{stall.location}</p>
        {Object.keys(stall.weeklyHours ?? {}).length ? <details><summary className="text-link">Weekly hours (IST)</summary>
          <dl className="vendor-facts">{weekdays.map(day=>{
            const hours = hoursOn(day,{opens:stall.opening,closes:stall.closing},stall.weeklyHours);
            return <div key={day}><dt>{day}</dt><dd>{hours ? hours.opens+"–"+hours.closes+(hours.closes<hours.opens?" (next day)":"") : "Closed"}</dd></div>;
          })}</dl></details> : <p className="row"><Clock3 size={18} />{stall.opening}–{stall.closing} IST{stall.closing<stall.opening?" (next day)":""}</p>}
        <Status tone={isOrderable(stall) && !data.orderingPaused ? "good" : "warn"}>{isOrderable(stall) && !data.orderingPaused ? "Scheduled pickup" : "Ordering paused"}</Status>
      </div>
    </section>
    <div className="menu-layout">
      <div className="menu-content">
        <div className="chips space-y-section">{["All", ...groups].map(item => <button key={item} aria-pressed={selectedCategory === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
        {!groups.length && <Empty title="Menu is being updated" />}
        {groups.filter(item => selectedCategory === "All" || item === selectedCategory).map(item => <section className="menu-group" key={item}>
          <h2>{item}</h2><div className="menu-grid">
            {menu.filter(product => product.category === item).map(product => <article className="panel product-card" key={product.id}>
              <Link href={`/products/${product.id}`} tabIndex={-1} aria-hidden="true"><Photo name={product.photo} /></Link>
              <div className="product-copy"><Link href={`/products/${product.id}`}><h3>{product.name}</h3></Link>
                <small>{product.diet}</small><p>{product.description}</p>
                <div className="row between"><strong>{money(product.price)}</strong><Quantity product={product} /></div>
              </div>
            </article>)}
          </div>
        </section>)}
      </div>
      <MenuBag />
    </div>
  </>;
}

function MenuBag() {
  const data = usePreview();
  const items = cartItems(data);
  const stall = data.stalls.find(item => item.id === items[0]?.stall);
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  return <aside className="menu-bag panel panel-pad stack" aria-label="Bag summary">
    <h2 className="row"><ShoppingBag size={20} /> Your bag</h2>
    {items.length ? <>
      <p>{stall?.name}</p>
      <ul className="stack">{items.map(item => <li className="row between" key={item.id}><span>{item.qty} × {item.name}</span><strong>{money(item.price * item.qty)}</strong></li>)}</ul>
      <div className="row between total"><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
      <Link className="button full" href="/bag">View bag <ArrowRight size={17} /></Link>
    </> : <p>Add a dish from the menu to start a pickup order.</p>}
  </aside>;
}

function ProductDetail({ id }: { id?: string }) {
  const data = usePreview();
  const product = data.products.find(item => item.id === id && !item.archived);
  const stall = data.stalls.find(item => item.id === product?.stall && item.approval === "Approved");
  if (!stall || !product) return <Empty title="Item unavailable"><Link className="button" href="/">Explore stalls</Link></Empty>;
  return <div className="narrow product-page"><Back href={`/stalls/${stall.id}`}>{stall.name}</Back><article className="panel product-detail">
    <Photo name={product.photo} /><div className="panel-pad">
      <p className="eyebrow">{product.category}</p><h1>{product.name}</h1>
      <p>{product.description}</p><p><Status tone="good">{product.diet}</Status></p>
      <div className="row between"><h2>{money(product.price)}</h2><Quantity product={product} /></div>
    </div>
  </article></div>;
}
