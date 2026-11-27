import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readLimitedBody } from "@/lib/request-body";
import { reviewLimits, validateReview, type Review } from "@/lib/reviews";
import { allowAttempt, allowNetworkAttempt } from "@/lib/staff/access";
import { staffService } from "@/lib/staff/supabase";
import { liveCommerce } from "@/lib/student-auth";
import { publicFormVerified } from "@/lib/turnstile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };
const reviewDirectory = () => process.env.CAMPUSBITE_REVIEW_DIR || join(process.cwd(), ".data", "reviews");
const requiresDatabase = () => liveCommerce() || process.env.VERCEL === "1";
const reviewFields = "id,name,rating,comment,createdAt:created_at";

async function fileReviews(): Promise<Review[]> {
  const directory = reviewDirectory();
  const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const recent = files.filter(file => /^\d{13}-[a-f\d-]{36}\.json$/.test(file))
    .sort().reverse().slice(0, reviewLimits.recent);
  return Promise.all(recent.map(async file => {
    const row = JSON.parse(await readFile(join(directory, file), "utf8"));
    const fields = validateReview(row);
    if (!fields || typeof row.id !== "string" || !Number.isFinite(Date.parse(row.createdAt))) throw new Error("Invalid review");
    return { id: row.id, ...fields, createdAt: row.createdAt };
  }));
}

export async function GET() {
  try {
    const service = staffService();
    if (!service && requiresDatabase()) throw new Error("Review storage unavailable");
    const stored = service
      ? await service.from("campus_reviews").select(reviewFields).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(reviewLimits.recent)
      : null;
    if (stored?.error) throw stored.error;
    const reviews = [...(stored?.data ?? []), ...await fileReviews()]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, reviewLimits.recent);
    return Response.json({ reviews }, { headers });
  } catch {
    return Response.json({ error: "Could not load reviews. Please try again." }, { status: 503, headers });
  }
}

const tooFrequent = (seconds: number) => Response.json({ error: "Please wait before posting another review." },
  { status: 429, headers: { ...headers, "Retry-After": String(seconds) } });

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    return Response.json({ error: "Submit the review using the form." }, { status: 415, headers });
  let input;
  let challenge: unknown;
  try {
    const raw = await readLimitedBody(request, 6144);
    if (!raw) return Response.json({ error: "Review is too large." }, { status: 413, headers });
    const submission = JSON.parse(raw.toString("utf8"));
    input = validateReview(submission);
    challenge = submission?.challenge;
  } catch { /* Return the same validation message for malformed submissions. */ }
  if (!input) return Response.json({ error: "Enter a display name, a rating from 1 to 5, and a review of up to 500 characters." }, { status: 400, headers });
  try {
    const verified = await publicFormVerified(challenge, "public-review");
    if (verified === null) return Response.json({ error: "Review verification is temporarily unavailable." }, { status: 503, headers });
    if (!verified)
      return Response.json({ error: "Complete the verification and try posting your review again." }, { status: 403, headers });
    const service = staffService();
    if (service) {
      const network = await allowNetworkAttempt(service, "public-reviews-network", 6, 600);
      if (network === null) throw new Error("Review limits unavailable");
      if (!network) return tooFrequent(600);
      const total = await allowAttempt(service, "public-reviews-total", "all", 180, 3600);
      if (total === null) throw new Error("Review limits unavailable");
      if (!total) return tooFrequent(3600);
      const { data, error } = await service.from("campus_reviews").insert(input).select(reviewFields).single();
      if (error || !data) throw new Error("Review storage unavailable");
      return Response.json({ review: data }, { status: 201, headers });
    }
    if (requiresDatabase()) throw new Error("Review storage unavailable");
    // Standalone preview shares one write slot per minute, including across processes.
    const now = Date.now();
    const review = { id: randomUUID(), ...input, createdAt: new Date(now).toISOString() };
    const directory = reviewDirectory();
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, review.id + ".tmp");
    const slot = now - now % 60_000;
    const destination = join(directory, slot + "-00000000-0000-0000-0000-000000000000.json");
    await writeFile(temporary, JSON.stringify(review), { flag: "wx" });
    try {
      await link(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return tooFrequent(60);
      throw error;
    } finally { await rm(temporary, { force: true }); }
    return Response.json({ review }, { status: 201, headers });
  } catch {
    return Response.json({ error: "Your review could not be saved. Please try again." }, { status: 503, headers });
  }
}
