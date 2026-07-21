/**
 * Read-only audit for employer/agency role provenance and organization trust.
 *
 * No email, name, raw uid, or billing identifier is printed. The operator must
 * provide the exact Firebase project explicitly to avoid auditing the wrong
 * environment through ambient credentials.
 */
const crypto = require("node:crypto");
const admin = require("firebase-admin");

const TRUSTED_PROVENANCE = new Set([
  "business_signup_callable",
  "stripe_checkout_webhook",
  "admin_sample_account",
]);
const BUSINESS_PLANS = new Set(["starter", "growth", "pro"]);

function option(name) {
  const prefix = `${name}=`;
  const entry = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return entry ? entry.slice(prefix.length).trim() : "";
}

function reference(projectId, uid) {
  return crypto.createHash("sha256").update(`${projectId}:${uid}`).digest("hex").slice(0, 12);
}

function exactBusinessBilling(data) {
  return Boolean(
    data &&
    data.provider === "stripe" &&
    data.active === true &&
    data.audience === "business" &&
    typeof data.plan === "string" &&
    BUSINESS_PLANS.has(data.plan) &&
    ["active", "trialing", "paid"].includes(data.status),
  );
}

async function main() {
  const projectId = option("--project");
  if (!/^[a-z0-9][a-z0-9-]{4,60}$/.test(projectId)) {
    throw new Error("Usage: node scripts/auditBusinessRoleProvenance.js --project=<exact-project-id>");
  }
  if (process.argv.slice(2).some((arg) => !arg.startsWith("--project="))) {
    throw new Error("Unknown argument. This audit accepts only --project=<exact-project-id>.");
  }

  const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId });
  const db = admin.firestore();
  const profiles = [];
  for (const role of ["employer", "agency"]) {
    const stream = db.collection("users").where("role", "==", role).stream();
    for await (const snapshot of stream) profiles.push(snapshot);
  }

  const billingByUid = new Map();
  for (let offset = 0; offset < profiles.length; offset += 100) {
    const chunk = profiles.slice(offset, offset + 100);
    const billing = await db.getAll(...chunk.map((profile) => db.collection("billing").doc(profile.id)));
    billing.forEach((snapshot) => billingByUid.set(snapshot.id, snapshot.data()));
  }

  const findings = profiles.map((profile) => {
    const data = profile.data() || {};
    const provenance = typeof data.role_provenance === "string" ? data.role_provenance : "missing";
    const billingProof = exactBusinessBilling(billingByUid.get(profile.id));
    const reasons = [];
    if (!TRUSTED_PROVENANCE.has(provenance) && !billingProof) reasons.push("role_provenance_unverified");
    if (data.organization_verified !== true) reasons.push("organization_identity_unverified");
    if (data.sample_account === true) reasons.push("sample_account_present");
    return {
      reference: reference(projectId, profile.id),
      role: data.role,
      provenance,
      billing_proof: billingProof,
      reasons,
    };
  });

  const review = findings.filter((finding) => finding.reasons.length > 0);
  const summary = {
    audit: "business_role_provenance",
    project: projectId,
    scanned: findings.length,
    trusted_role_provenance: findings.filter((item) => !item.reasons.includes("role_provenance_unverified")).length,
    verified_organizations: findings.filter((item) => !item.reasons.includes("organization_identity_unverified")).length,
    review_required: review.length,
    findings: review,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (review.length > 0) process.exitCode = 2;
  await app.delete();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Business role provenance audit failed.");
  process.exitCode = 1;
});
