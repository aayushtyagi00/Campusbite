import type { WeeklyHours } from "../campus";

export const vendorRoles = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
} as const;

export type VendorRole = keyof typeof vendorRoles;
export type StaffArea = "admin" | "vendor";

export type VendorShop = { id: string; name: string; created_at: string };
export type VendorAccess = { shop_id: string; email: string; role: VendorRole; created_at: string };
export const applicationStatuses = { draft: "Draft", submitted: "Submitted", under_review: "Under review", changes_requested: "Changes requested", approved: "Approved", rejected: "Rejected", suspended: "Suspended" } as const;
export type ApplicationStatus = keyof typeof applicationStatuses;
export type ApplicationDocument = { path: string; name: string };
export type VendorApplication = {
  id: string; shop_name: string; contact_name: string; email: string; phone: string;
  location: string; description: string; status: ApplicationStatus; created_at: string;
  court: string; cuisine: string; opens: string | null; closes: string | null; registration: string;
  documents: ApplicationDocument[]; agreement_version: string | null; agreed_at: string | null;
  verified_at: string | null; applicant_id: string | null; review_note: string; shop_id: string | null; revision: number;
};
export type Storefront = {
  slug: string; shop_id: string | null; display_name: string; court: string; location: string; cuisine: string;
  photo: string; opens: string | null; closes: string | null; capacity: number; published: boolean; enabled: boolean;
  standing: "approved" | "suspended"; payment_status: "not_started" | "pending" | "verified" | "legacy_enabled";
  provider_ref: string; revision: number; vendor_paused: boolean; closed_dates: string[]; basket_limit: number;
  menu_categories: string[]; weekly_hours: WeeklyHours; pickup_minutes: number;
};
export type VendorOrder = {
  id: string; shop_id: string; reference: string;
  status: "awaiting" | "accepted" | "preparing" | "ready" | "collected" | "cancelled" | "expired" | "rejected";
  pickup_at: string;
  items?: { name: string; qty: number; price?: number }[];
  preparation_note?: string;
};
export type BoardOrder = VendorOrder & {
  pickup_minutes: number; accept_until: string | null; prep_minutes: number | null; amount_paise: number | null;
  rejection_reason: string | null; refund: string | null; events: { status: string; at: number }[];
};
export type Earnings = { captured: number; orders: number; refunded: number; refund_pending: number };
export type VendorSale = { id: string; shop_id: string; reference: string; amount_paise: number; recorded_at: string };

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row; Insert: Insert; Update: Update; Relationships: [];
};

export type StaffDatabase = {
  public: {
    Tables: {
      staff_admins: Table<{ email: string }>;
      vendor_shops: Table<VendorShop, { name: string }>;
      vendor_access: Table<VendorAccess>;
      vendor_applications: Table<VendorApplication>;
      vendor_orders: Table<VendorOrder>;
      vendor_sales: Table<VendorSale>;
      commerce_stalls: Table<Storefront>;
      commerce_menu: Table<CommerceMenuRow>;
    };
    Views: Record<never, never>;
    Functions: {
      campusbite_is_admin: { Args: Record<never, never>; Returns: boolean };
      campusbite_consume_attempt: { Args: { p_bucket: string; p_key_hash: string; p_limit: number; p_seconds: number }; Returns: boolean };
      campusbite_grant_vendor_access: { Args: { p_shop_id: string; p_email: string; p_role: VendorRole }; Returns: undefined };
      vendor_application_summary: { Args: { target_shop:string }; Returns: {status:ApplicationStatus;agreed_at:string|null;agreement_version:string|null;document_count:number}|null };
      vendor_order_feed: { Args: { target_shop: string; selected_order?: string }; Returns: BoardOrder[] };
      vendor_reject_order: { Args: { order_id: string; reason: string }; Returns: boolean };
      vendor_earnings: { Args: { target_shop: string; since_time: string; until_time: string }; Returns: Earnings };
      vendor_save_category: { Args: { target_shop: string; previous_name: string; new_name: string }; Returns: undefined };
      vendor_set_schedule: { Args: { target_shop: string; expected_revision: number; opening: string; closing: string; slots: number; basket: number; paused: boolean; closures: string[]; weekly: WeeklyHours; minutes: number }; Returns: undefined };
      vendor_write_item: { Args: { target_shop: string; item_id: string; expected_revision: number; fields: Record<string,string|number|boolean> }; Returns: undefined };
      commerce_fulfill: { Args: { order_id: string; next_status: string; submitted_code: string }; Returns: boolean };
      review_vendor_application: { Args: { application_id: string; expected_revision: number; decision: string; note: string; existing_shop?: string }; Returns: undefined };
      save_vendor_storefront: { Args: { target_shop: string; expected_revision: number; details: Record<string,string | number | boolean> }; Returns: undefined };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};

export type CommerceMenuRow = {
  id: string; stall_slug: string; name: string; category: string;
  description: string; price: number; prep: number; diet: string; photo: string; sold_out: boolean; archived: boolean; revision: number;
};
