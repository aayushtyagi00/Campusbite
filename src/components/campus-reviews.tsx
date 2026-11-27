"use client";

import { MessageSquarePlus, Star } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { reviewLimits, type Review } from "@/lib/reviews";
import { Notice } from "./ui";
import { Challenge } from "./challenge";

const ratings = [1, 2, 3, 4, 5];
const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

export function CampusReviews({ siteKey }: { siteKey?: string }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [posting, setPosting] = useState(false);
  const [challengeVersion, setChallengeVersion] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [rating, setRating] = useState(0);
  const [visibleCount, setVisibleCount] = useState(6);
  const formToggle = useRef<HTMLButtonElement>(null);
  const attempts = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/reviews", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Could not load reviews");
        const data: { reviews: Review[] } = await response.json();
        setReviews(data.reviews);
      } catch {
        if (!controller.signal.aborted) setLoadingError("Reviews are temporarily unavailable. Reload the page to try again.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (attempts.current) return;
    attempts.current = true;
    const input = new FormData(event.currentTarget);
    setPosting(true);
    setError("");
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: input.get("name"), comment: input.get("comment"), rating, challenge: input.get("cf-turnstile-response") }),
      });
      const data: { review?: Review; error?: string } = await response.json();
      if (!response.ok || !data.review) throw new Error(data.error || "Your review could not be saved. Please try again.");
      const posted = data.review;
      setReviews(current => [posted, ...current].slice(0, reviewLimits.recent));
      setSuccess("Your review is published.");
      setExpanded(false);
      setRating(0);
      formToggle.current?.focus();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your review could not be saved. Please try again.");
    } finally {
      setPosting(false);
      attempts.current = false;
      setChallengeVersion(version => version + 1);
    }
  }

  return <section className="campus-reviews" id="campus-reviews" aria-labelledby="reviews-title">
    <div className="reviews-heading">
      <div><h2 id="reviews-title">CampusBite reviews</h2><p>Share your campus pickup experience.</p></div>
      <button ref={formToggle} type="button" className="button secondary" aria-expanded={expanded} onClick={() => {
        setExpanded(!expanded);
        setError("");
        setSuccess("");
      }}><MessageSquarePlus size={18} /> {expanded ? "Close review form" : "Write a review"}</button>
    </div>
    {expanded && <form className="panel panel-pad stack review-form" onSubmit={submit}>
      <label className="field">Display name<input name="name" autoComplete="nickname" required maxLength={reviewLimits.name} /></label>
      <fieldset>
        <legend>Rating</legend>
        <div className="review-rating">
          {ratings.map(value => <label key={value}>
            <input className="sr-only" type="radio" name="rating" value={value} required checked={rating === value} onChange={() => setRating(value)} aria-label={`${value} ${value === 1 ? "star" : "stars"}`} />
            <Star size={22} fill={value <= rating ? "currentColor" : "none"} aria-hidden="true" /><span>{value}</span>
          </label>)}
        </div>
      </fieldset>
      <label className="field">Your review<textarea name="comment" required maxLength={reviewLimits.comment} rows={4} /></label>
      <p className="fineprint">Your display name, rating, and review will be public. Leave out contact details and order codes.</p>
      {error && <Notice>{error}</Notice>}
      {siteKey && <Challenge key={challengeVersion} siteKey={siteKey} action="public-review" />}
      <button className="button" disabled={posting || loading}>{posting ? "Publishing…" : "Publish review"}</button>
    </form>}
    {success && <Notice>{success}</Notice>}
    {loading ? <p className="fineprint" role="status">Loading reviews…</p> :
      loadingError && <Notice>{loadingError}</Notice>}
    {!loading && !loadingError && !reviews.length && <div className="panel review-empty">
      <Star size={22} aria-hidden="true" /><p>Be the first to leave a CampusBite review.</p>
    </div>}
    {!!reviews.length && <ul className="review-grid">
      {reviews.slice(0, visibleCount).map(review => <li className="panel review-card" key={review.id}>
        <div className="review-stars" role="img" aria-label={`${review.rating} out of 5 stars`}>
          {ratings.map(value => <Star key={value} size={16} fill={value <= review.rating ? "currentColor" : "none"} aria-hidden="true" />)}
        </div>
        <blockquote>{review.comment}</blockquote>
        <div className="review-byline"><strong>{review.name}</strong><time dateTime={review.createdAt}>{dateFormat.format(new Date(review.createdAt))}</time></div>
      </li>)}
    </ul>}
    {reviews.length > visibleCount && <button type="button" className="button secondary" onClick={() => setVisibleCount(count => count + 6)}>Show more reviews</button>}
  </section>;
}
