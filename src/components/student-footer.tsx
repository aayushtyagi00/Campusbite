import Link from "next/link";
import { MapPin } from "lucide-react";
import { Brand } from "./ui";

export function StudentFooter() {
  return <footer className="student-footer">
    <div className="wrap">
      <div className="footer-columns">
        <div className="footer-brand">
          <Brand />
          <p>Order ahead from campus cafés and food stalls and spend less of your break in line.</p>
          <p className="row"><MapPin size={17} /> Lovely Professional University</p>
        </div>
        <nav aria-label="Explore CampusBite">
          <h2>Explore CampusBite</h2>
          <Link href="/">Home</Link>
          <Link href="/order-online">Order Online</Link>
          <Link className="footer-about" href="/about">About CampusBite</Link>
          <Link href="/#campus-reviews">Reviews</Link>
          <Link href="/vendor">Vendor portal</Link>
        </nav>
        <nav aria-label="Help and policies">
          <h2>Help and policies</h2>
          <Link href="/support">Support</Link>
          <Link href="/orders">Track my order</Link>
          <Link href="/pickup-refunds">Pickup &amp; Refunds</Link>
          <Link href="/privacy-policy">Privacy Policy</Link>
        </nav>
      </div>
      <div className="footer-note">© CampusBite</div>
    </div>
  </footer>;
}
