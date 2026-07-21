import type { Timestamp } from 'firebase/firestore';

export type MessageTemplateKey =
  | 'interview_invite'
  | 'request_info'
  | 'rejection'
  | 'offer_followup'
  | 'custom';

export interface ApplicationMessage {
  id: string;
  application_id: string;
  sender_role: 'employer' | 'candidate';
  sender_uid: string;
  body: string;
  template_key: MessageTemplateKey;
  created_at: Timestamp | null;
}

const TEMPLATE_KEYS = new Set<MessageTemplateKey>([
  'interview_invite',
  'request_info',
  'rejection',
  'offer_followup',
  'custom',
]);

const cleanString = (value: unknown, max = 4000): string => (
  typeof value === 'string' ? value.trim().slice(0, max) : ''
);

function cleanTemplateKey(value: unknown): MessageTemplateKey {
  return typeof value === 'string' && TEMPLATE_KEYS.has(value as MessageTemplateKey)
    ? value as MessageTemplateKey
    : 'custom';
}

function cleanSenderRole(value: unknown): 'employer' | 'candidate' {
  return value === 'employer' ? 'employer' : 'candidate';
}

function cleanTimestamp(value: unknown): Timestamp | null {
  return value && typeof (value as { toDate?: unknown }).toDate === 'function'
    ? value as Timestamp
    : null;
}

export function normalizeApplicationMessage(id: string, data: unknown): ApplicationMessage {
  const raw = data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};

  return {
    id: cleanString(id, 160),
    application_id: cleanString(raw.application_id, 160),
    sender_role: cleanSenderRole(raw.sender_role),
    sender_uid: cleanString(raw.sender_uid, 160),
    body: cleanString(raw.body, 4000),
    template_key: cleanTemplateKey(raw.template_key),
    created_at: cleanTimestamp(raw.created_at),
  };
}
