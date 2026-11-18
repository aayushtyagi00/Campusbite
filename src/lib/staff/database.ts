export const vendorRoles = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
} as const;

export type VendorRole = keyof typeof vendorRoles;
export type StaffArea = "admin" | "vendor";

export type VendorShop = { id: string; name: string; created_at: string };
export type VendorAccess = { shop_id: string; email: string; role: VendorRole; created_at: string };
export type VendorApplication = {
  id: string; shop_name: string; contact_name: string; email: string; phone: string;
  location: string; description: string; status: "submitted" | "reviewed"; created_at: string;
};
export type VendorOrder = {
  id: string; shop_id: string; reference: string;
  status: "awaiting" | "accepted" | "preparing" | "ready" | "collected" | "cancelled" | "expired" | "rejected";
  pickup_at: string;
  items?: { name: string; qty: number }[];
  preparation_note?: string;
};
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
      vendor_applications: Table<VendorApplication, Omit<VendorApplication, "id" | "status" | "created_at">>;
      vendor_orders: Table<VendorOrder>;
      vendor_sales: Table<VendorSale>;
      commerce_stalls: Table<{ slug: string; shop_id: string; capacity: number; enabled: boolean }>;
      commerce_menu: Table<CommerceMenuRow>;
    };
    Views: Record<never, never>;
    Functions: {
      campusbite_is_admin: { Args: Record<never, never>; Returns: boolean };
      campusbite_consume_attempt: { Args: { p_bucket: string; p_key_hash: string; p_limit: number; p_seconds: number }; Returns: boolean };
      campusbite_grant_vendor_access: { Args: { p_shop_id: string; p_email: string; p_role: VendorRole }; Returns: undefined };
      commerce_fulfill: { Args: { order_id: string; next_status: string; submitted_code: string }; Returns: boolean };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};

export type CommerceMenuRow = {
  id: string; stall_slug: string; name: string; category: "Meals" | "Wraps" | "Drinks" | "Snacks";
  description: string; price: number; prep: number; diet: string; photo: string; sold_out: boolean;
};
