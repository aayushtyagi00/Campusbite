"use client";

import { ArrowRight, Check, ChevronDown, Home, MapPin, ReceiptText, ShoppingBag, UserRound, Utensils, X } from "lucide-react";
import Link from "next/link";
import { NavigationHint } from "./navigation-hint";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cartItems, LiveStorefronts, update, usePreview, usePreviewReady } from "@/lib/preview";
import { foodCourts, money, type Product, type Stall } from "@/lib/campus";
import { Brand } from "./ui";
import { StudentFooter } from "./student-footer";

const navigation = [
  { href: "/", label: "Home" },
  { href: "/order-online", label: "Order Online" },
  { href: "/about", label: "About CampusBite" },
];
const mobileNavigation = [
  { href: "/", label: "Home Page", icon: Home },
  { href: "/order-online", label: "Order Online", icon: Utensils },
  { href: "/account", label: "Account", icon: UserRound },
];

function ProfileMenu({ selectCourt }: { selectCourt: () => void }) {
  const profile = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  function close() { if (profile.current) profile.current.open = false; }

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !profile.current?.contains(event.target)) close();
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  return <details ref={profile} className="profile-menu" onKeyDown={event => {
    if (event.key === "Escape" && profile.current?.open) {
      close();
      trigger.current?.focus();
    }
  }}>
    <summary ref={trigger} className="header-action profile-trigger"><UserRound size={17} /> Profile <ChevronDown size={14} /></summary>
    <div className="profile-popover">
      <div className="profile-identity">
        <span className="profile-avatar" aria-hidden="true"><UserRound size={19} /></span>
        <div><strong>CampusBite account</strong><small>CampusBite ordering</small></div>
      </div>
      <Link href="/orders" onClick={close}><ReceiptText size={19} /><span><strong>My orders</strong><small>Track pickup and view order history</small></span><NavigationHint /></Link>
      <button type="button" onClick={() => { close(); selectCourt(); }}><MapPin size={19} /><span><strong>Select Food Court</strong><small>Change your campus pickup area</small></span></button>
      <Link href="/account" onClick={close}><UserRound size={19} /><span><strong>My account</strong><small>Manage your account</small></span><NavigationHint /></Link>
    </div>
  </details>;
}

export function StudentShell({ children, storefronts }: { children: React.ReactNode; storefronts: { stalls: Stall[]; products: Product[]; live: boolean } }) {
  return <LiveStorefronts.Provider value={storefronts}><StudentNavigation>{children}</StudentNavigation></LiveStorefronts.Provider>;
}

function StudentNavigation({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const data = usePreview();
  const ready = usePreviewReady();
  const courtDialog = useRef<HTMLDialogElement>(null);
  const courtTrigger = useRef<HTMLButtonElement>(null);
  const currentCourt = foodCourts.find(court => court.id === data.foodCourt) ?? foodCourts[0];
  function selectCourt() { courtDialog.current?.showModal(); }
  const items = cartItems(data);
  const count = items.reduce((sum, item) => sum + item.qty, 0);
  const total = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  const ordering = /^\/(order-online|court|stalls|products|bag|checkout)(\/|$)/.test(path);
  const active = ordering ? "/order-online" : path;
  const mobileActive = /^\/(account|sign-in|recovery|orders|about)(\/|$)/.test(path) ? "/account" : active;
  const showBag = count > 0 && (path === "/" || /^\/(order-online|court|stalls|products)(\/|$)/.test(path));
  return <>
    <header className="student-header"><div className="wrap header-inner">
      <div className="student-brand"><Brand /></div>
      <nav aria-label="Main navigation" className="student-nav"><div className="nav-inner">
        {navigation.map(({ href, label }) => <Link key={href} prefetch={["/", "/order-online", "/about"].includes(href) ? true : undefined} href={href} aria-current={active === href ? "page" : undefined}>{label}<NavigationHint /></Link>)}
      </div></nav>
      <div className="header-actions">
        <button className="header-action court-trigger" ref={courtTrigger} type="button" onClick={selectCourt} aria-haspopup="dialog" aria-label={`Select Food Court, ${currentCourt.name}`} disabled={!ready}>
          <MapPin size={16} /> <span className="court-label"><strong>Select Food Court</strong><small>{currentCourt.id === "unimall" && <span className="mobile-court-prefix">LPU · </span>}{currentCourt.name}</small></span><ChevronDown size={13} />
        </button>
        <ProfileMenu key={path} selectCourt={selectCourt} />
        <Link href="/bag" className="header-action cart-trigger" aria-label={`Cart, ${count} ${count === 1 ? "item" : "items"}`}><ShoppingBag size={20} /><strong className="cart-label">Cart</strong>{count > 0 && <span className="cart-count">{count}</span>}<NavigationHint /></Link>
      </div>
    </div></header>
    <dialog className="panel dialog court-dialog" ref={courtDialog} aria-labelledby="food-court-title"
      onClose={() => courtTrigger.current?.focus()}>
      <div className="row between">
        <h2 id="food-court-title">Select Food Court</h2>
        <button className="court-dismiss" type="button" onClick={() => courtDialog.current?.close()} aria-label="Close food court selector"><X size={20} /></button>
      </div>
      <p>Choose where you’d like to pick up your order.</p>
      <ul className="court-options">
        {foodCourts.map(court => <li key={court.id}><button type="button"
          aria-pressed={court.id === currentCourt.id} onClick={() => {
            update(current => ({ ...current, foodCourt: court.id }));
            courtDialog.current?.close();
          }}><MapPin size={18} /> {court.name}{court.id === currentCourt.id && <Check size={18} className="push" />}</button></li>)}
      </ul>
    </dialog>
    <main className={`wrap student-main ${showBag ? "with-bag" : ""}`} id="main">{children}</main>
    <StudentFooter />
    {showBag && <aside className="bag-float">
      <div><strong>{count} {count === 1 ? "item" : "items"} · {money(total)}</strong><small>{data.stalls.find(stall => stall.id === items[0]?.stall)?.name}</small></div>
      <Link className="button" href="/bag">View bag <ArrowRight size={17} /><NavigationHint /></Link>
    </aside>}
    <nav aria-label="Main navigation" className="mobile-student-nav">
      <div className="wrap mobile-nav-inner">
        {mobileNavigation.map(({ href, label, icon: Icon }) => <Link key={href} prefetch={["/", "/order-online", "/about"].includes(href) ? true : undefined} href={href} aria-current={mobileActive === href ? "page" : undefined}><Icon size={20} aria-hidden="true" />{label}<NavigationHint /></Link>)}
      </div>
    </nav>
  </>;
}
