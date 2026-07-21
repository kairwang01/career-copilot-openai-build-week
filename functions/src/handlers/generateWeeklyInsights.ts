/**
 * generateWeeklyInsights — scheduled Cloud Function (runs weekly, Monday 06:00 UTC).
 *
 * SCRUM-31: "As a candidate, I see a fresh weekly AI insight on my dashboard."
 *
 * For every ACTIVE candidate, gathers the user's recent activity (resume
 * analyses + tool usage over the last 7 days) and asks the server-side LLM to
 * write a short weekly insight: a `summary_text` plus one `actionable_tip`.
 * The result is written to `users/{uid}/weekly_insights/{week_start_date}` so the
 * candidate dashboard can render a fresh card each week.
 *
 * "Active" gate (cost control): a user is only processed when they logged at
 * least one activity signal in the trailing 7-day window (a resume analysis or
 * a tool event). Dormant accounts cost no LLM call.
 *
 * Idempotency: the doc id IS the ISO week-start date ("YYYY-MM-DD"), and we skip
 * any user who already has that week's doc. A retried or doubly-fired schedule
 * can therefore never duplicate or overwrite a week's insight.
 *
 * Pattern mirrors grantMonthlyCredits.ts (onSchedule, region inherited from
 * index.ts setGlobalOptions, per-user loop with best-effort error isolation).
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { Type } from "@google/genai";
import { USERS_COLLECTION, USER_FIELDS } from "../credits/schema";
import { resolveProvider } from "../llm/models";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/** Per-user subcollection holding the weekly AI insight cards. */
const WEEKLY_INSIGHTS_COLLECTION = "weekly_insights";

/** Trailing activity window used to decide "active" and to summarize. */
const WINDOW_DAYS = 7;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Hard cap so one cron run can't fan out to an unbounded LLM bill. */
const MAX_USERS_PER_RUN = 500;

/** Maps a tool_key to a short human label for the prompt summary. */
const TOOL_LABELS: Record<string, string> = {
  "resume-analysis": "Resume analysis",
  "resume-formatter": "Resume formatter",
  "opportunity-finder": "Opportunity finder",
  "linkedin-optimizer": "LinkedIn optimizer",
  "cover-letter": "Cover letter",
  "mock-interview": "Mock interview",
  "career-path": "Career path planner",
  "salary-negotiation": "Salary negotiation",
  "english-pro": "English practice",
  "email-crafter": "Email crafter",
  "networking-assistant": "Networking assistant",
  "performance-review-prep": "Performance review prep",
  "skill-learning-plan": "Skill learning plan",
  "industry-event-scout": "Industry event scout",
};

/** ISO "YYYY-MM-DD" for the Monday (UTC) that starts the given date's week. */
function isoWeekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay(): 0=Sun..6=Sat. Shift so Monday is the first day of the week.
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d.toISOString().split("T")[0];
}

interface ActivitySnapshot {
  resumeScores: number[];
  latestImprovements: string[];
  latestKeywords: string[];
  toolUsage: string[]; // tool_key list, most recent first
}

/**
 * Reads the user's trailing-7-day activity. Returns null when the user logged
 * nothing in the window (dormant — skip the LLM call).
 */
async function gatherActivity(uid: string, since: Date): Promise<ActivitySnapshot | null> {
  const base = db.collection(USERS_COLLECTION).doc(uid);

  const [analysesSnap, eventsSnap] = await Promise.all([
    base
      .collection("resume_analyses")
      .where("created_at", ">=", since)
      .orderBy("created_at", "desc")
      .limit(10)
      .get(),
    base
      .collection("tool_events")
      .where("created_at", ">=", since)
      .orderBy("created_at", "desc")
      .limit(20)
      .get(),
  ]);

  if (analysesSnap.empty && eventsSnap.empty) {
    return null; // no activity this week
  }

  const resumeScores: number[] = [];
  let latestImprovements: string[] = [];
  let latestKeywords: string[] = [];
  analysesSnap.docs.forEach((doc, i) => {
    const data = doc.data();
    if (typeof data.score === "number") resumeScores.push(data.score);
    if (i === 0) {
      if (Array.isArray(data.improvements)) {
        latestImprovements = data.improvements
          .map((imp: unknown) =>
            imp && typeof imp === "object" && "area" in imp
              ? String((imp as { area: unknown }).area)
              : String(imp),
          )
          .slice(0, 5);
      }
      if (Array.isArray(data.keywords)) {
        latestKeywords = data.keywords.map((k: unknown) => String(k)).slice(0, 8);
      }
    }
  });

  const toolUsage = eventsSnap.docs
    .map((doc) => {
      const key = doc.get("tool_key");
      return typeof key === "string" ? key : null;
    })
    .filter((k): k is string => Boolean(k));

  return { resumeScores, latestImprovements, latestKeywords, toolUsage };
}

const INSIGHT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary_text: { type: Type.STRING },
    actionable_tip: { type: Type.STRING },
  },
  required: ["summary_text", "actionable_tip"],
};

/**
 * Builds the prompt payload from the activity snapshot. Grounded strictly in the
 * supplied data — the model is told not to invent facts.
 */
function buildInsightPrompt(activity: ActivitySnapshot): string {
  const toolCounts: Record<string, number> = {};
  for (const key of activity.toolUsage) {
    toolCounts[key] = (toolCounts[key] ?? 0) + 1;
  }
  const toolLines = Object.entries(toolCounts)
    .map(([key, count]) => `- ${TOOL_LABELS[key] ?? key}: used ${count}x`)
    .join("\n");

  const data = {
    resume_readiness_scores_this_week: activity.resumeScores,
    latest_resume_improvement_areas: activity.latestImprovements,
    latest_resume_keywords: activity.latestKeywords,
    tools_used_this_week: toolCounts,
  };

  return [
    "You are a concise, encouraging career coach writing ONE candidate's weekly insight card for their job-search dashboard. The goal is engagement and retention: make it feel personal, specific, and worth coming back for.",
    "",
    "WEEKLY ACTIVITY (JSON — the ONLY source of truth; never invent counts, scores, tools, companies, or dates):",
    JSON.stringify(data),
    "",
    toolLines ? `Tool usage breakdown:\n${toolLines}` : "No tools were used this week.",
    "",
    "Write a JSON object with exactly two string fields:",
    '- "summary_text": 2-3 sentences (max ~60 words) reflecting on what the candidate actually did this week, grounded only in the data above. Reference real numbers when present (e.g. a resume score, how many tools they tried). Warm, second-person (\"you\"), no clichés, no markdown.',
    '- "actionable_tip": ONE specific, doable-this-week next step (max ~30 words) that builds on the activity — e.g. address a surfaced resume gap, try a tool they have not used, or follow up. Imperative voice, no fluff.',
    "",
    "Return only the JSON object matching the schema.",
  ].join("\n");
}

export const generateWeeklyInsightsFunction = onSchedule(
  { schedule: "0 6 * * 1", timeZone: "UTC", timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    const now = new Date();
    const weekStart = isoWeekStart(now);
    const since = new Date(now.getTime() - WINDOW_MS);

    let generated = 0;
    let skippedExisting = 0;
    let skippedDormant = 0;
    let failed = 0;

    // Only candidates get a job-search weekly insight (employers/agencies excluded).
    const usersSnap = await db
      .collection(USERS_COLLECTION)
      .where(USER_FIELDS.role, "==", "candidate")
      .limit(MAX_USERS_PER_RUN)
      .get();

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const insightRef = userDoc.ref.collection(WEEKLY_INSIGHTS_COLLECTION).doc(weekStart);

      try {
        // Idempotency: skip if this week's insight already exists.
        const existing = await insightRef.get();
        if (existing.exists) {
          skippedExisting++;
          continue;
        }

        const activity = await gatherActivity(uid, since);
        if (!activity) {
          skippedDormant++;
          continue;
        }

        const provider = await resolveProvider(uid);
        const result = await provider.generate({
          prompt: buildInsightPrompt(activity),
          responseSchema: INSIGHT_SCHEMA,
          temperature: 0.7,
        });

        const parsed = (result.raw ?? {}) as {
          summary_text?: unknown;
          actionable_tip?: unknown;
        };
        const summaryText =
          typeof parsed.summary_text === "string" ? parsed.summary_text.trim() : "";
        const actionableTip =
          typeof parsed.actionable_tip === "string" ? parsed.actionable_tip.trim() : "";

        if (!summaryText) {
          // Model returned nothing usable (e.g. truncated JSON) — don't write a
          // blank card; let next week's run retry.
          failed++;
          continue;
        }

        // Idempotent write: create() fails if a concurrent run already wrote this
        // week's doc, so we never overwrite an existing insight.
        await insightRef.create({
          week_start_date: admin.firestore.Timestamp.fromDate(new Date(`${weekStart}T00:00:00.000Z`)),
          summary_text: summaryText,
          actionable_tip: actionableTip,
          created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        generated++;
      } catch (err) {
        // ALREADY_EXISTS from a concurrent create() is a benign idempotency win.
        if ((err as { code?: number | string })?.code === 6) {
          skippedExisting++;
        } else {
          failed++;
          logger.error(`generateWeeklyInsights: failed for users/${uid}`, err);
        }
      }
    }

    logger.info(
      `generateWeeklyInsights ${weekStart}: generated ${generated}, ` +
        `skippedExisting ${skippedExisting}, skippedDormant ${skippedDormant}, ` +
        `failed ${failed}, scanned ${usersSnap.size}`,
    );
  },
);
