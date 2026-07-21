import { describe, expect, it } from 'vitest';
import { normalizeApplicationMessage } from '../lib/applicationMessageNormalize';

describe('application message normalization', () => {
  it('keeps valid message fields', () => {
    const createdAt = { toDate: () => new Date('2026-06-24T10:00:00.000Z') };
    const message = normalizeApplicationMessage('msg1', {
      application_id: 'app1',
      sender_role: 'employer',
      sender_uid: 'emp1',
      body: '  Please send your availability.  ',
      template_key: 'request_info',
      created_at: createdAt,
    });

    expect(message).toMatchObject({
      id: 'msg1',
      application_id: 'app1',
      sender_role: 'employer',
      sender_uid: 'emp1',
      body: 'Please send your availability.',
      template_key: 'request_info',
      created_at: createdAt,
    });
  });

  it('sanitizes malformed Firestore payloads before React renders them', () => {
    const message = normalizeApplicationMessage(' msg-bad ', {
      application_id: 42,
      sender_role: 'system',
      sender_uid: {},
      body: { text: 'not renderable as a React child' },
      template_key: 'unknown',
      created_at: 'yesterday',
    });

    expect(message).toEqual({
      id: 'msg-bad',
      application_id: '',
      sender_role: 'candidate',
      sender_uid: '',
      body: '',
      template_key: 'custom',
      created_at: null,
    });
  });
});
