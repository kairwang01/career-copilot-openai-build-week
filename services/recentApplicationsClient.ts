import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../lib/firebaseClient';

export interface RecentApplication {
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

const listRecentApplicationsCallable = httpsCallable<
  Record<string, never>,
  { applications: RecentApplication[] }
>(firebaseFunctions, 'listRecentApplications');

export async function listRecentApplications(): Promise<RecentApplication[]> {
  const result = await listRecentApplicationsCallable({});
  return result.data.applications;
}
