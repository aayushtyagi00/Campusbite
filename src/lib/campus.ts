export const foodCourts = [
  { id: "unimall", name: "UniMall" },
  { id: "block-2-cc", name: "Near Block 2 - CC" },
  { id: "block-41", name: "Near Block 41" },
  { id: "boys-hostel-5-6", name: "Near Boys' Hostel 5-6" },
] as const;
export type FoodCourtId = (typeof foodCourts)[number]["id"];
export const defaultFoodCourt = foodCourts[0].id;

export type Category = "Meals" | "Wraps" | "Drinks" | "Snacks";
export type Stall = {
  id: string; name: string; location: string; cuisine: string; photo: string;
  foodCourt?: FoodCourtId;
  opening: string; closing: string; capacity: number; paused: boolean; closedDates?: string[]; basketLimit?: number;
  approval: "Draft" | "Submitted" | "Under review" | "Approved" | "Changes requested" | "Rejected" | "Suspended";
};

export function stallsAtCourt(stalls: Stall[], court: FoodCourtId) {
  return stalls.filter(stall => stall.approval === "Approved" && (stall.foodCourt ?? defaultFoodCourt) === court);
}
export type Product = {
  id: string; stall: string; name: string; category: Category; description: string;
  price: number; prep: number; diet: string; photo: string; soldOut: boolean; archived?: boolean;
};
export type CartLine = { id: string; qty: number; unitPrice?: number };
export type PickupSlot = { start: number; end: number };
export type Fulfillment = "awaiting" | "accepted" | "preparing" | "ready" | "collected" | "rejected" | "expired" | "cancelled";
export type Order = {
  id: string; stall: string; name: string; location: string; items: { name: string; price: number; qty: number }[];
  student: string; total: number; note: string; slot: PickupSlot; placed: number; deadline: number;
  prepStart?: number;
  status: Fulfillment; payment: "Verified"; refund: "None" | "Requested" | "Pending" | "Succeeded";
  code: string; events: { status: string; at: number }[];
};
export const categories: Category[] = ["Meals", "Wraps", "Drinks", "Snacks"];
export const basketLimit = 8;
export const statuses: Record<Fulfillment, string> = {
  awaiting: "Awaiting acceptance", accepted: "Accepted", preparing: "Preparing", ready: "Ready for pickup",
  collected: "Collected", rejected: "Rejected", expired: "Expired", cancelled: "Cancelled",
};

export const stalls: Stall[] = [
  { id: "rolling-kitchen", name: "The Rolling Kitchen", location: "Stall 04 · Level 1, UniMall", cuisine: "Wraps, bowls & rolls", photo: "rolling", opening: "10:00", closing: "20:00", capacity: 5, paused: false, approval: "Approved" },
  { id: "chai-co", name: "Chai & Co", location: "Stall 07 · Central Atrium, UniMall", cuisine: "Fresh chai, bun maska & snacks", photo: "chai", opening: "09:00", closing: "20:00", capacity: 5, paused: false, approval: "Approved" },
  { id: "punjab-plate", name: "Punjab Plate", location: "Stall 02 · North Wing, UniMall", cuisine: "North Indian thalis & quick combos", photo: "punjab", opening: "10:00", closing: "20:00", capacity: 5, paused: false, approval: "Approved" },
];

export const products: Product[] = [
  { id: "paneer", stall: "rolling-kitchen", name: "Paneer Tikka Wrap", category: "Wraps", description: "Grilled paneer, crunchy onions and mint chutney in a soft wrap. Contains milk and wheat.", price: 11000, prep: 7, diet: "Vegetarian", photo: "paneer", soldOut: false },
  { id: "aloo", stall: "rolling-kitchen", name: "Aloo Tikki Wrap", category: "Wraps", description: "Crisp spiced potato, crunchy vegetables and tangy chutney. Contains wheat.", price: 8000, prep: 6, diet: "Vegetarian", photo: "aloo", soldOut: false },
  { id: "bowl", stall: "rolling-kitchen", name: "Mexican Rice Bowl", category: "Meals", description: "Seasoned rice, beans, grilled vegetables and bright tomato salsa.", price: 13900, prep: 8, diet: "Vegetarian", photo: "", soldOut: false },
  { id: "fries", stall: "rolling-kitchen", name: "Masala Crispy Fries", category: "Snacks", description: "Crisp fries tossed in the stall’s masala seasoning.", price: 6500, prep: 5, diet: "Vegetarian", photo: "fries", soldOut: true },
  { id: "kulhad", stall: "rolling-kitchen", name: "Kulhad Masala Chai", category: "Drinks", description: "Slow-brewed spiced milk tea served in a clay cup. Contains milk.", price: 4000, prep: 4, diet: "Vegetarian", photo: "kulhad", soldOut: false },
  { id: "adrak", stall: "chai-co", name: "Adrak Elaichi Chai", category: "Drinks", description: "Milk tea with fresh ginger and cardamom. Contains milk.", price: 3500, prep: 4, diet: "Vegetarian", photo: "kulhad", soldOut: false },
  { id: "samosa", stall: "chai-co", name: "Samosa Pav", category: "Snacks", description: "Potato samosa in a soft pav with green chutney. Contains wheat.", price: 5500, prep: 5, diet: "Vegetarian", photo: "", soldOut: false },
  { id: "bun", stall: "chai-co", name: "Bun Maska & Chai", category: "Snacks", description: "Buttered bun and a cup of house chai. Contains wheat and milk.", price: 7500, prep: 5, diet: "Vegetarian", photo: "chai", soldOut: false },
  { id: "dal", stall: "punjab-plate", name: "Dal Makhani Combo", category: "Meals", description: "Slow-cooked black lentils, rice, pickle and curd. Contains milk.", price: 13900, prep: 9, diet: "Vegetarian", photo: "punjab", soldOut: false },
  { id: "kulcha", stall: "punjab-plate", name: "Amritsari Kulcha", category: "Meals", description: "Stuffed kulcha, chole and pickled onions. Contains wheat and milk.", price: 11900, prep: 9, diet: "Vegetarian", photo: "", soldOut: false },
];

export const money = (paise: number) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2,
}).format(paise / 100);
const zone = "Asia/Kolkata";
const time = new Intl.DateTimeFormat("en-IN", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true });
const date = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
const day = new Intl.DateTimeFormat("en-IN", { timeZone: zone, day: "numeric", month: "short" });
export const clockTime = (value: number) => time.format(value).toUpperCase();
export const dateLabel = (value: number) => day.format(value);
export function slotLabel(slot: PickupSlot) {
  const start = clockTime(slot.start);
  const end = clockTime(slot.end);
  const suffix = end.slice(-2);
  return `${start.endsWith(suffix) ? start.slice(0, -2).trim() : start}–${end}`;
}

export function isOrderable(stall: Stall) {
  return stall.approval === "Approved" && !stall.paused;
}

export function basketPrepMinutes(lines: { prep: number; qty: number }[]) {
  return Math.max(4, ...lines.map(line => line.prep)) + Math.max(0, lines.reduce((sum, line) => sum + line.qty, 0) - 1) * 2;
}

export function pickupSlots(
  stall: Stall, lines: { prep: number; qty: number }[],
  orders: (Pick<Order, "stall" | "slot" | "deadline"> & { status: Order["status"] | "unpaid" })[], now: number, deadlineNow = now,
): PickupSlot[] {
  if (!isOrderable(stall)) return [];
  const minute = 60_000;
  const interval = 10 * minute;
  const prep = basketPrepMinutes(lines);
  const earliest = now + (prep + 3.5) * minute;
  const campusDate = date.format(now);
  if (stall.closedDates?.includes(campusDate) || lines.reduce((sum, line) => sum + line.qty, 0) > (stall.basketLimit ?? basketLimit)) return [];
  const open = Date.parse(`${campusDate}T${stall.opening}:00+05:30`);
  const close = Date.parse(`${campusDate}T${stall.closing}:00+05:30`);
  const slots: PickupSlot[] = [];
  for (let start = Math.ceil(Math.max(open, earliest) / interval) * interval; start <= now + 60 * minute && start + interval <= close; start += interval) {
    const committed = orders.filter(order => order.stall === stall.id && order.slot.start === start &&
      !["cancelled", "expired", "rejected"].includes(order.status) && !(order.status === "awaiting" && order.deadline <= deadlineNow)).length;
    if (committed < stall.capacity) slots.push({ start, end: start + interval });
  }
  return slots;
}
