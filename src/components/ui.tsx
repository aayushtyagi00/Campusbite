import Link from "next/link";
import { ArrowLeft, CircleAlert, CookingPot, Store } from "lucide-react";

export function Brand() {
  return <Link href="/" className="brand" aria-label="CampusBite home"><Store size={25} strokeWidth={2.4} /><span>campusbite<span className="brand-dot">.</span></span></Link>;
}
export function Photo({ name, className = "" }: { name: string; className?: string }) {
  return name ? <img className={`photo ${className}`} src={`/food/${name}.jpg`} alt="" /> :
    <div className={`photo photo-empty ${className}`} aria-hidden="true"><CookingPot size={28} /></div>;
}
export function Back({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link className="back" href={href}><ArrowLeft size={17} />{children}</Link>;
}
export function Notice({ children }: { children: React.ReactNode }) {
  return <p className="notice" role="status"><CircleAlert size={18} /> <span>{children}</span></p>;
}
export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="panel empty"><h2>{title}</h2>{children}</div>;
}
export function Status({ children, tone = "" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`status ${tone}`}>{children}</span>;
}
