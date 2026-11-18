export const reviewLimits = { name: 60, comment: 500, recent: 30 };

export type Review = {
  id: string;
  name: string;
  rating: number;
  comment: string;
  createdAt: string;
};

export function validateReview(input: unknown): Pick<Review, "name" | "rating" | "comment"> | undefined {
  if (!input || typeof input !== "object") return;
  const { name, rating, comment } = input as Record<string, unknown>;
  if (typeof name !== "string" || typeof comment !== "string" || typeof rating !== "number") return;

  const displayName = name.trim().replace(/\s+/g, " ");
  const message = comment.trim();
  if (!displayName || displayName.length > reviewLimits.name || !message || message.length > reviewLimits.comment) return;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return;

  return { name: displayName, rating, comment: message };
}
