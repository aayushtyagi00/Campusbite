import { ArrowRight, CalendarClock, ChevronDown, MapPin, ShoppingBag, Store } from "lucide-react";
import Link from "next/link";
import { isOrderable, money, type Product, type Stall } from "@/lib/campus";
import { Photo } from "./ui";

const pickupSteps = [
  { icon: Store, title: "Choose a vendor", description: "Select a food court and find a dish from one of its cafés or stalls." },
  { icon: CalendarClock, title: "Pick a time", description: "Add your food to the bag and select an available 10-minute pickup window at checkout." },
  { icon: ShoppingBag, title: "Collect at the stall", description: "Check My Orders and show your six-digit pickup code when your order is ready." },
];

export function HomeGuide({ court, vendors, products }: { court: string; vendors: Stall[]; products: Product[] }) {
  const featured = vendors.filter(isOrderable).flatMap(stall => {
    const menu = products.filter(product => product.stall === stall.id && !product.archived && !product.soldOut);
    const item = menu.find(product => product.photo) ?? menu[0];
    return item ? [{ stall, item }] : [];
  }).slice(0, 3);

  return <>
    {featured.length > 0 && <section className="home-section" aria-labelledby="menu-picks">
      <div className="home-section-heading">
        <div><h2 id="menu-picks">From the menus</h2><p>A few things to try at {court}.</p></div>
        <Link className="text-link row" href="/order-online">Browse all menus <ArrowRight size={17} /></Link>
      </div>
      <ul className="home-menu-grid">
        {featured.map(({ stall, item }) => <li key={item.id}>
          <Link href={`/products/${item.id}`} className="panel home-dish">
            <div className="home-dish-photo"><Photo name={item.photo} /></div>
            <div className="home-dish-copy">
              <p className="row"><MapPin size={14} />{stall.name}</p>
              <h3>{item.name}</h3>
              <div className="row between"><strong>{money(item.price)}</strong><ArrowRight size={18} /></div>
            </div>
          </Link>
        </li>)}
      </ul>
    </section>}
    <section className="home-section pickup-guide" aria-labelledby="pickup-guide">
      <div className="pickup-intro">
        <h2 id="pickup-guide">How campus pickup works</h2>
        <p>Plan your food break around your class schedule.</p>
        <div className="row wrap-row">
          <Link className="button" href="/order-online">Start an order <ArrowRight size={17} /></Link>
          <Link className="button secondary" href="/orders">Track an order</Link>
        </div>
      </div>
      <ol className="pickup-steps">
        {pickupSteps.map(({ icon: Icon, title, description }) => <li key={title}>
          <span className="pickup-step-icon"><Icon size={20} aria-hidden="true" /></span>
          <div><h3>{title}</h3><p>{description}</p></div>
        </li>)}
      </ol>
    </section>
    <section className="home-section home-faq" aria-labelledby="home-faq">
      <div className="home-section-heading">
        <h2 id="home-faq">Pickup questions</h2>
        <Link className="text-link row" href="/support">Visit Support <ArrowRight size={17} /></Link>
      </div>
      <div className="panel home-faq-list">
        <details>
          <summary>Where do I collect my order?<ChevronDown size={18} aria-hidden="true" /></summary>
          <p>Collect it from the stall you ordered from. Open My Orders to see the stall location, pickup window, and code once it’s ready.</p>
        </details>
        <details>
          <summary>Can I order from more than one stall?<ChevronDown size={18} aria-hidden="true" /></summary>
          <p>Each bag is for one stall. Place a separate order if you want food from another vendor.</p>
        </details>
        <details>
          <summary>Can I cancel my order?<ChevronDown size={18} aria-hidden="true" /></summary>
          <p>You can cancel from My Orders while the vendor is still deciding whether to accept it. <Link className="text-link" href="/pickup-refunds">Read the pickup and refund guide.</Link></p>
        </details>
      </div>
    </section>
  </>;
}
