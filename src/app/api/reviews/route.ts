import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { reviewLimits, validateReview, type Review } from "@/lib/reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };
const reviewDirectory = () => process.env.CAMPUSBITE_REVIEW_DIR || join(process.cwd(), ".data", "reviews");

export async function GET() {
  try {
    const directory = reviewDirectory();
    const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const latest = files.filter(file => /^\d{13}-[a-f\d-]{36}\.json$/.test(file))
      .sort().reverse().slice(0, reviewLimits.recent);
    const reviews = await Promise.all(latest.map(async file => JSON.parse(await readFile(join(directory, file), "utf8")) as Review));
    return Response.json({ reviews }, { headers });
  } catch (error) {
    console.error("Could not read CampusBite reviews", error);
    return Response.json({ error: "Could not load reviews. Please try again." }, { status: 503, headers });
  }
}

async function readReviewBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const decoder = new TextDecoder();
  let size = 0;
  let input = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return JSON.parse(input + decoder.decode()) as unknown;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return undefined;
      }
      input += decoder.decode(value, { stream: true });
    }
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return Response.json({ error: "Submit the review using the form." }, { status: 415, headers });
  }
  const input = validateReview(await readReviewBody(request));
  if (!input) {
    return Response.json({ error: "Enter a display name, a rating from 1 to 5, and a review of up to 500 characters." }, { status: 400, headers });
  }
  const now = Date.now();
  const review: Review = { id: randomUUID(), ...input, createdAt: new Date(now).toISOString() };
  const directory = reviewDirectory();
  const destination = join(directory, `${now}-${review.id}.json`);
  const temporary = destination + ".tmp";
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, JSON.stringify(review), { encoding: "utf8", flag: "wx" });
    await rename(temporary, destination);
    return Response.json({ review }, { status: 201, headers });
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    console.error("Could not save a CampusBite review", error);
    return Response.json({ error: "Your review could not be saved. Please try again." }, { status: 503, headers });
  }
}
