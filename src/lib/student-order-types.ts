import type { Order } from "./campus";

export type StudentOrder = Omit<Order, "student" | "status" | "payment"> & {
  holdingUntil?: string;
  status: Order["status"] | "unpaid"; payment: "Verified" | "Pending" | "Failed"; support?: string; support_reply?: string; support_state?: string; rejection_reason?: string;
};
export type StudentOrderHistory = { signedIn: boolean; orders: StudentOrder[]; unavailable?: boolean;
  preferences?: { orderAlerts: boolean; refundAlerts: boolean } };

const selectedOrderKey = "campusbite.preview.selected-order";

export function selectedStudentOrder() {
  try { return sessionStorage.getItem(selectedOrderKey); } catch { return null; }
}

export function selectStudentOrder(id: string | null) {
  try {
    if (id) sessionStorage.setItem(selectedOrderKey, id);
    else sessionStorage.removeItem(selectedOrderKey);
  } catch { /* The order list can still be opened. */ }
}
