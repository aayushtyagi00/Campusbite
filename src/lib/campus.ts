export const foodCourts = [
  { id: "unimall", name: "UniMall" },
  { id: "block-2-cc", name: "Near Block 2 - CC" },
  { id: "block-41", name: "Near Block 41" },
  { id: "boys-hostel-5-6", name: "Near Boys' Hostel 5-6" },
] as const;
export type FoodCourtId = (typeof foodCourts)[number]["id"];
export const defaultFoodCourt = foodCourts[0].id;

export const weekdays = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"] as const;
export type Weekday = typeof weekdays[number];
export type Hours = { opens: string; closes: string };
export type WeeklyHours = Partial<Record<Weekday, Hours | null>>;

export function hoursOn(day: Weekday, defaults: Hours, weekly?: WeeklyHours): Hours | null {
  const override = weekly?.[day];
  return override === undefined ? defaults : override;
}
export type Stall = {
  id: string; name: string; location: string; cuisine: string; photo: string;
  foodCourt?: FoodCourtId; weeklyHours?: WeeklyHours; pickupMinutes?: number;
  opening: string; closing: string; capacity: number; paused: boolean; closedDates?: string[]; basketLimit?: number;
  approval: "Draft" | "Submitted" | "Under review" | "Approved" | "Changes requested" | "Rejected" | "Suspended";
};

export function stallsAtCourt(stalls: Stall[], court: FoodCourtId) {
  return stalls.filter(stall => stall.approval === "Approved" && (stall.foodCourt ?? defaultFoodCourt) === court);
}
export type Product = {
  id: string; stall: string; name: string; category: string; description: string;
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
export const categories: string[] = ["Meals", "Wraps", "Drinks", "Snacks"];
export const basketLimit = 8;
export const statuses: Record<Fulfillment, string> = {
  awaiting: "Awaiting acceptance", accepted: "Accepted", preparing: "Preparing", ready: "Ready for pickup",
  collected: "Collected", rejected: "Rejected", expired: "Expired", cancelled: "Cancelled",
};

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
  const interval = (stall.pickupMinutes ?? 10) * minute;
  const prep = basketPrepMinutes(lines);
  const earliest = now + (prep + 3.5) * minute;
  const latest = now + 60 * minute;
  const units = lines.reduce((sum,line) => sum + line.qty, 0);
  if (units > (stall.basketLimit ?? basketLimit)) return [];

  const slots: PickupSlot[] = [];
  for (const campusDate of new Set([date.format(now), date.format(latest)])) {
    if (stall.closedDates?.includes(campusDate)) continue;
    const dayIndex = (new Date(campusDate+"T00:00:00Z").getUTCDay()+6)%7;
    const hours = hoursOn(weekdays[dayIndex], {opens:stall.opening, closes:stall.closing}, stall.weeklyHours);
    if (!hours) continue;
    const open = Date.parse(`${campusDate}T${hours.opens}:00+05:30`);
    const close = Date.parse(`${campusDate}T${hours.closes}:00+05:30`);
    const first = open + Math.max(0, Math.ceil((earliest-open)/interval)) * interval;
    for (let start = first; start <= latest && start + interval <= close; start += interval) {
      const committed = orders.filter(order => order.stall === stall.id && order.slot.start < start+interval && order.slot.end > start &&
        !["cancelled","expired","rejected"].includes(order.status) && !(order.status === "awaiting" && order.deadline <= deadlineNow)).length;
      if (committed < stall.capacity) slots.push({start, end:start+interval});
    }
  }
  return slots;
}
