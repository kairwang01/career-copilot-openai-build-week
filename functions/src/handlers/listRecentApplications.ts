/**
 * Bounded, server-side recent-application list for the signed-in candidate.
 *
 * The previous client flow read every application and then issued one posting
 * read per row. Besides scaling poorly, a single denied posting read could turn
 * the entire result into a misleading empty state. This callable authorizes by
 * the verified uid, limits the query, and batch-enriches posting data.
 */

import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { requireAuth } from "../middleware/auth";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
export const RECENT_APPLICATION_LIMIT = 20;

export interface RecentApplicationResult {
  id: string;
  job_id: string;
  job_title: string;
  company_name: string;
  location: string;
  description: string;
  responsibilities: string;
  required_qualifications: string;
  status: string;
  application_date: string;
}

const stringValue = (value: unknown): string =>
  typeof value === "string" ? value : "";

const isoFromTimestamp = (value: unknown): string => {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as Timestamp).toDate().toISOString();
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  return "";
};

export async function listRecentApplicationsImpl(
  uid: string,
): Promise<{ applications: RecentApplicationResult[] }> {
  const applicationsSnap = await db
    .collection("job_applications")
    .where("candidate_id", "==", uid)
    .orderBy("application_date", "desc")
    .limit(RECENT_APPLICATION_LIMIT)
    .get();

  const rows = applicationsSnap.docs.map((document) => {
    const data = document.data();
    return {
      id: document.id,
      job_id: stringValue(data.job_id),
      job_title: stringValue(data.job_title),
      status: stringValue(data.status),
      application_date: isoFromTimestamp(data.application_date),
    };
  });

  const jobIds = Array.from(new Set(rows.map((row) => row.job_id).filter(Boolean)));
  const postingSnapshots = jobIds.length
    ? await db.getAll(...jobIds.map((jobId) => db.collection("job_postings").doc(jobId)))
    : [];
  const postingById = new Map(
    postingSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => [snapshot.id, snapshot.data()!] as const),
  );

  return {
    applications: rows.map((row) => {
      const posting = postingById.get(row.job_id);
      return {
        ...row,
        job_title: stringValue(posting?.title) || row.job_title,
        company_name: stringValue(posting?.company_name),
        location: stringValue(posting?.location),
        description: stringValue(posting?.description),
        responsibilities: stringValue(posting?.responsibilities),
        required_qualifications: stringValue(posting?.required_qualifications),
      };
    }),
  };
}

export const listRecentApplicationsFunction = onCall(
  { invoker: "public" },
  (request) => listRecentApplicationsImpl(requireAuth(request)),
);
