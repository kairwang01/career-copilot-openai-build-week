/**
 * interviewProgress — composes the candidate "your application moved forward"
 * email enqueued by the onApplicationStatusChange trigger.
 *
 * Delivery is handled by the Firebase "Trigger Email from Firestore" extension
 * (writes to the `mail` collection). This module only decides WHEN to email and
 * renders the message.
 *
 * English first (the platform serves North America); fr/zh fall back to English
 * for now, matching the app's English-fallback i18n policy.
 *
 * Self-contained on purpose: functions/ is a separate TS package and cannot
 * cleanly import the root lib/applicationPipeline.ts, so the stage vocabulary is
 * mirrored here (keep in sync with lib/applicationPipeline.ts).
 */

const STAGE_LABELS_EN: Record<string, string> = {
  "Applied": "Applied",
  "Group Interview": "Group Interview",
  "First Interview": "First Interview",
  "Second Interview": "Second Interview",
  "Decision Maker Interview": "Decision-Maker Interview",
  "HR Interview": "HR Interview",
  "Offer": "Offer",
  "Hiring Evaluation": "Hiring Evaluation",
  "Intent Letter": "Intent Letter",
  "Offer Confirmed": "Offer Confirmed",
  "Tripartite Agreement": "Tripartite Agreement",
  "Signed": "Signed",
  "Rejected": "Closed",
};

// Progress groups (mirror lib/applicationPipeline.ts APPLICATION_PROGRESS_GROUPS).
const PROGRESS_GROUPS: { id: string; statuses: string[] }[] = [
  { id: "applied", statuses: ["Applied"] },
  { id: "interview", statuses: ["Group Interview", "First Interview", "Second Interview", "Decision Maker Interview", "HR Interview"] },
  { id: "offer", statuses: ["Offer", "Hiring Evaluation", "Intent Letter", "Offer Confirmed"] },
  { id: "signing", statuses: ["Tripartite Agreement", "Signed"] },
];

const KNOWN = new Set(Object.keys(STAGE_LABELS_EN));

// Aliases an external/legacy/localized status maps to (mirror of
// lib/applicationPipeline.ts STATUS_ALIASES — firestore.rules also stores
// 'Hired'/'Interviewing', so without these they'd wrongly fall through to
// 'Applied' and drop the email).
const STATUS_ALIASES: Record<string, string> = {
  applied: "Applied", apply: "Applied", submitted: "Applied", "resume submitted": "Applied",
  "投递简历": "Applied", "已投递": "Applied",
  interviewing: "First Interview", interview: "First Interview",
  "interview-stage": "First Interview", "interview stage": "First Interview", "面试中": "First Interview",
  "group interview": "Group Interview", "集体面试": "Group Interview",
  "first interview": "First Interview", "初试": "First Interview",
  "second interview": "Second Interview", "复试": "Second Interview",
  "decision maker interview": "Decision Maker Interview", "hiring manager interview": "Decision Maker Interview",
  "用人决策者面试": "Decision Maker Interview",
  "hr interview": "HR Interview", "hr面试": "HR Interview",
  offer: "Offer", "录用评估中": "Hiring Evaluation", "hiring evaluation": "Hiring Evaluation",
  "intent letter": "Intent Letter", "确认意向书": "Intent Letter",
  "offer confirmed": "Offer Confirmed", accepted: "Offer Confirmed", "确认offer": "Offer Confirmed",
  "tripartite agreement": "Tripartite Agreement", "三方协议": "Tripartite Agreement",
  signed: "Signed", hired: "Signed", "签约": "Signed", "已录用": "Signed",
  rejected: "Rejected", closed: "Rejected", declined: "Rejected", "未通过": "Rejected",
};

/** Map an arbitrary stored status to a canonical pipeline status. */
export function normalizeStatus(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return "Applied";
  if (KNOWN.has(v)) return v;
  const lower = v.toLowerCase();
  const hit = [...KNOWN].find((s) => s.toLowerCase() === lower);
  if (hit) return hit;
  return STATUS_ALIASES[v] ?? STATUS_ALIASES[lower] ?? "Applied";
}

function groupIndexOf(status: string): number {
  return PROGRESS_GROUPS.findIndex((g) => g.statuses.includes(status));
}

export type ProgressEmailKind = "advance" | "closed" | null;

/**
 * Decide whether a status transition warrants an email, and which template.
 * - "advance": the candidate entered a NEW, forward progress group
 *   (interview/offer/signing). Lateral moves within a group do not email.
 * - "closed": moved to Rejected — a separate, respectful update (no interview info).
 * - null: not meaningful (e.g. Applied, a backward move, or a within-group bump).
 */
export function classifyTransition(beforeRaw: unknown, afterRaw: unknown): { kind: ProgressEmailKind; status: string } {
  const after = normalizeStatus(afterRaw);
  const before = normalizeStatus(beforeRaw);
  if (after === before) return { kind: null, status: after };
  if (after === "Rejected") return { kind: "closed", status: after };
  const fromGroup = before === "Rejected" ? -1 : groupIndexOf(before);
  const toGroup = groupIndexOf(after);
  // Forward entry into interview (1) / offer (2) / signing (3) only.
  if (toGroup >= 1 && toGroup > fromGroup) return { kind: "advance", status: after };
  return { kind: null, status: after };
}

export interface RenderInput {
  lang?: string | null; // reserved for future fr/zh templates; English-first today
  kind: "advance" | "closed";
  candidateName: string;
  jobTitle: string;
  company: string;
  location: string;
  status: string; // normalized
  appId: string;
  baseUrl: string;
}

export interface RenderedEmail { subject: string; html: string; text: string; }

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderInterviewProgressEmail(input: RenderInput): RenderedEmail {
  // fr/zh fall back to English for now (English-first policy).
  return renderEn(input);
}

function renderEn(i: RenderInput): RenderedEmail {
  const firstName = (i.candidateName.trim().split(/\s+/)[0]) || "there";
  const stage = STAGE_LABELS_EN[i.status] ?? i.status;
  const company = i.company || "the company";
  const jobTitle = i.jobTitle || "the role";
  const location = i.location || "To be confirmed";
  const portalUrl = `${i.baseUrl.replace(/\/$/, "")}/workspace?app=${encodeURIComponent(i.appId)}`;

  if (i.kind === "closed") {
    const subject = `An update on your application — ${jobTitle} at ${company}`;
    const lines = [
      `Hi ${firstName},`,
      ``,
      `Thank you for your interest in ${jobTitle} at ${company}, and for the time you put into your application.`,
      ``,
      `After careful consideration, the hiring team has decided not to move forward with your application at this time. This decision is never easy, and it does not take away from your skills and experience.`,
      ``,
      `Your profile stays on Career CoPilot, and you can keep using your tools and apply to other roles whenever you're ready:`,
      ``,
      `  ${portalUrl}`,
      ``,
      `We wish you the very best in your search.`,
      ``,
      `Warm regards,`,
      `The Career CoPilot Team`,
    ];
    return { subject, text: lines.join("\n"), html: wrapHtml(subject, lines, portalUrl, jobTitle, company) };
  }

  const subject = `You're moving forward — ${jobTitle} at ${company}`;
  const lines = [
    `Hi ${firstName},`,
    ``,
    `Good news — your application for ${jobTitle} at ${company} has advanced to the ${stage} stage.`,
    ``,
    `The hiring team would like to move ahead with the next step. Please review the details below and confirm your availability.`,
    ``,
    `Interview details`,
    `  • Position: ${jobTitle}`,
    `  • Company / Department: ${company}`,
    `  • Location: ${location}`,
    `  • Current stage: ${stage}`,
    `  • Interview date & time: To be confirmed (the team will confirm this with you)`,
    `  • Format: To be confirmed (e.g. video call, phone, or on-site)`,
    ``,
    `Please log in to Career CoPilot to review your application and confirm your availability:`,
    ``,
    `  ${portalUrl}`,
    ``,
    `Once you're signed in, open "My Applications" to see your full progress timeline, confirm or propose a time, and find everything you need to prepare.`,
    ``,
    `If you have any questions, just reply to this email and we'll be happy to help.`,
    ``,
    `Best regards,`,
    `The Career CoPilot Team`,
  ];
  return { subject, text: lines.join("\n"), html: wrapHtml(subject, lines, portalUrl, jobTitle, company) };
}

function wrapHtml(subject: string, lines: string[], portalUrl: string, jobTitle: string, company: string): string {
  const body = lines
    .map((l) => {
      if (l === "") return "";
      if (l.trim().startsWith("•")) return `<div style="margin:2px 0 2px 8px">${esc(l.trim())}</div>`;
      if (l.trim() === portalUrl) {
        return `<p style="margin:14px 0"><a href="${esc(portalUrl)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;font-weight:600">Open Career CoPilot</a></p>`;
      }
      return `<p style="margin:10px 0;line-height:1.6">${esc(l)}</p>`;
    })
    .filter((s) => s !== "")
    .join("\n");
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e7eb">
    <div style="font-weight:700;font-size:18px;color:#2563eb;margin-bottom:6px">Career CoPilot</div>
    ${body}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:22px 0">
    <p style="font-size:12px;color:#6b7280;line-height:1.5">You're receiving this because you applied to ${esc(jobTitle)} at ${esc(company)} through Career CoPilot. Manage your notifications in your account settings.</p>
  </div></body></html>`;
}
