/**
 * Cloud Storage security-rules tests for user uploads and application snapshots.
 *
 * These tests intentionally start both emulators because storage.rules reads the
 * authoritative users/{uid}.role document for role-gated uploads.
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-careercopilot \
 *        "npx vitest run tests/storage.rules.test.ts"
 */
import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const PROJECT_ID = 'demo-careercopilot';
const BUCKET_URL = `gs://${PROJECT_ID}.appspot.com`;
const MIB = 1024 * 1024;
const SMALL_FILE_BYTES = 32;

let testEnv: RulesTestEnvironment;

const objectRef = (ctx: RulesTestContext, path: string) =>
  ctx.storage(BUCKET_URL).ref(path);

const upload = (
  ctx: RulesTestContext,
  path: string,
  contentType: string,
  size = SMALL_FILE_BYTES,
) => objectRef(ctx, path)
  .put(new Uint8Array(size), { contentType })
  .then((snapshot) => snapshot);

const seedRole = async (uid: string, role: 'candidate' | 'employer' | 'agency') => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { role });
  });
};

const seedObject = async (path: string, contentType: string, size = SMALL_FILE_BYTES) => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await upload(ctx, path, contentType, size);
  });
};

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(process.env.FIRESTORE_RULES_PATH || 'firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
    storage: {
      rules: readFileSync(process.env.STORAGE_RULES_PATH || 'storage.rules', 'utf8'),
      host: '127.0.0.1',
      port: 9197,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await Promise.all([testEnv.clearFirestore(), testEnv.clearStorage()]);
});

describe('avatars/{userId}/{fileName}', () => {
  it('lets the owner upload, read, replace, and delete a valid raster image', async () => {
    const owner = testEnv.authenticatedContext('cand1');
    const path = 'avatars/cand1/123e4567-e89b-12d3-a456-426614174000.png';

    await assertSucceeds(upload(owner, path, 'image/png'));
    await assertSucceeds(objectRef(owner, path).getMetadata());
    await assertSucceeds(upload(owner, path, 'image/png', 64));
    await assertSucceeds(objectRef(owner, path).delete());
  });

  it('allows every signed-in product role to own an avatar namespace', async () => {
    for (const [uid, role] of [
      ['cand1', 'candidate'],
      ['emp1', 'employer'],
      ['agency1', 'agency'],
    ] as const) {
      await seedRole(uid, role);
      await assertSucceeds(upload(
        testEnv.authenticatedContext(uid),
        `avatars/${uid}/123e4567-e89b-12d3-a456-426614174000.webp`,
        'image/webp',
      ));
    }
  });

  it('lets another signed-in user read an avatar but not mutate it', async () => {
    const owner = testEnv.authenticatedContext('cand1');
    const other = testEnv.authenticatedContext('other');
    const path = 'avatars/cand1/123e4567-e89b-12d3-a456-426614174000.jpg';

    await assertSucceeds(upload(owner, path, 'image/jpeg'));
    await assertSucceeds(objectRef(other, path).getMetadata());
    await assertFails(upload(other, path, 'image/jpeg'));
    await assertFails(objectRef(other, path).delete());
  });

  it('denies unauthenticated reads and writes', async () => {
    const unauthenticated = testEnv.unauthenticatedContext();
    const path = 'avatars/cand1/123e4567-e89b-12d3-a456-426614174000.png';
    await seedObject(path, 'image/png');

    await assertFails(objectRef(unauthenticated, path).getMetadata());
    await assertFails(upload(unauthenticated, path, 'image/png'));
    await assertFails(objectRef(unauthenticated, path).delete());
  });

  it('denies active content, MIME/extension mismatches, and non-generated names', async () => {
    const owner = testEnv.authenticatedContext('cand1');

    await assertFails(upload(
      owner,
      'avatars/cand1/123e4567-e89b-12d3-a456-426614174000.svg',
      'image/svg+xml',
    ));
    await assertFails(upload(
      owner,
      'avatars/cand1/123e4567-e89b-12d3-a456-426614174000.jpg',
      'image/png',
    ));
    await assertFails(upload(owner, 'avatars/cand1/friendly_name.png', 'image/png'));
  });

  it('enforces non-empty files and the exclusive 5 MiB boundary', async () => {
    const owner = testEnv.authenticatedContext('cand1');

    await assertFails(upload(
      owner,
      'avatars/cand1/123e4567-e89b-12d3-a456-426614174000.png',
      'image/png',
      0,
    ));
    await assertFails(upload(
      owner,
      'avatars/cand1/223e4567-e89b-12d3-a456-426614174000.png',
      'image/png',
      5 * MIB,
    ));
    await assertSucceeds(upload(
      owner,
      'avatars/cand1/323e4567-e89b-12d3-a456-426614174000.png',
      'image/png',
      5 * MIB - 1,
    ));
  });
});

describe('company-logos/{userId}/{fileName}', () => {
  it('lets an employer upload, read, replace, and delete its own valid logo', async () => {
    await seedRole('emp1', 'employer');
    const employer = testEnv.authenticatedContext('emp1');
    const path = 'company-logos/emp1/123e4567-e89b-12d3-a456-426614174000.png';

    await assertSucceeds(upload(employer, path, 'image/png'));
    await assertSucceeds(objectRef(employer, path).getMetadata());
    await assertSucceeds(upload(employer, path, 'image/png', 64));
    await assertSucceeds(objectRef(employer, path).delete());
  });

  it('fails closed for a missing profile and non-employer roles', async () => {
    await seedRole('cand1', 'candidate');
    await seedRole('agency1', 'agency');

    await assertFails(upload(
      testEnv.authenticatedContext('missing-profile'),
      'company-logos/missing-profile/123e4567-e89b-12d3-a456-426614174000.png',
      'image/png',
    ));
    await assertFails(upload(
      testEnv.authenticatedContext('cand1'),
      'company-logos/cand1/123e4567-e89b-12d3-a456-426614174000.png',
      'image/png',
    ));
    await assertFails(upload(
      testEnv.authenticatedContext('agency1'),
      'company-logos/agency1/123e4567-e89b-12d3-a456-426614174000.png',
      'image/png',
    ));
  });

  it('lets signed-in users view a logo but only its owner mutate it', async () => {
    await seedRole('emp1', 'employer');
    const employer = testEnv.authenticatedContext('emp1');
    const other = testEnv.authenticatedContext('emp2');
    const path = 'company-logos/emp1/123e4567-e89b-12d3-a456-426614174000.gif';

    await assertSucceeds(upload(employer, path, 'image/gif'));
    await assertSucceeds(objectRef(other, path).getMetadata());
    await assertFails(upload(other, path, 'image/gif'));
    await assertFails(objectRef(other, path).delete());
    await assertFails(objectRef(testEnv.unauthenticatedContext(), path).getMetadata());
  });

  it('keeps owner cleanup available after a role downgrade', async () => {
    await seedRole('emp1', 'employer');
    const employer = testEnv.authenticatedContext('emp1');
    const path = 'company-logos/emp1/123e4567-e89b-12d3-a456-426614174000.png';
    await assertSucceeds(upload(employer, path, 'image/png'));
    await seedRole('emp1', 'candidate');

    await assertFails(upload(employer, path, 'image/png'));
    await assertSucceeds(objectRef(employer, path).delete());
  });

  it('rejects SVG and the exclusive 5 MiB boundary', async () => {
    await seedRole('emp1', 'employer');
    const employer = testEnv.authenticatedContext('emp1');

    await assertFails(upload(
      employer,
      'company-logos/emp1/123e4567-e89b-12d3-a456-426614174000.svg',
      'image/svg+xml',
    ));
    await assertFails(upload(
      employer,
      'company-logos/emp1/223e4567-e89b-12d3-a456-426614174000.png',
      'image/png',
      5 * MIB,
    ));
  });
});

describe('resumes/{userId}/{fileName}', () => {
  it.each([
    ['pdf', 'application/pdf'],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['txt', 'text/plain'],
    ['png', 'image/png'],
    ['jpg', 'image/jpeg'],
    ['jpeg', 'image/jpg'],
  ])('allows a candidate to upload a supported .%s file', async (extension, contentType) => {
    await seedRole('cand1', 'candidate');
    await assertSucceeds(upload(
      testEnv.authenticatedContext('cand1'),
      `resumes/cand1/123e4567-e89b-12d3-a456-426614174000.${extension}`,
      contentType,
    ));
  });

  it('allows octet-stream only when a generated path has a supported extension', async () => {
    await seedRole('cand1', 'candidate');
    const candidate = testEnv.authenticatedContext('cand1');

    await assertSucceeds(upload(
      candidate,
      'resumes/cand1/123e4567-e89b-12d3-a456-426614174000.docx',
      'application/octet-stream',
    ));
    await assertFails(upload(
      candidate,
      'resumes/cand1/223e4567-e89b-12d3-a456-426614174000.exe',
      'application/octet-stream',
    ));
  });

  it('keeps resume reads private to the owner and denies non-owner mutation', async () => {
    await seedRole('cand1', 'candidate');
    await seedRole('emp1', 'employer');
    const candidate = testEnv.authenticatedContext('cand1');
    const employer = testEnv.authenticatedContext('emp1');
    const path = 'resumes/cand1/123e4567-e89b-12d3-a456-426614174000.pdf';

    await assertSucceeds(upload(candidate, path, 'application/pdf'));
    await assertSucceeds(objectRef(candidate, path).getMetadata());
    await assertFails(objectRef(employer, path).getMetadata());
    await assertFails(objectRef(testEnv.unauthenticatedContext(), path).getMetadata());
    await assertFails(upload(employer, path, 'application/pdf'));
    await assertFails(objectRef(employer, path).delete());
    await assertSucceeds(objectRef(candidate, path).delete());
  });

  it('fails closed for missing profiles, employers, and agencies', async () => {
    await seedRole('emp1', 'employer');
    await seedRole('agency1', 'agency');

    await assertFails(upload(
      testEnv.authenticatedContext('missing-profile'),
      'resumes/missing-profile/123e4567-e89b-12d3-a456-426614174000.pdf',
      'application/pdf',
    ));
    await assertFails(upload(
      testEnv.authenticatedContext('emp1'),
      'resumes/emp1/123e4567-e89b-12d3-a456-426614174000.pdf',
      'application/pdf',
    ));
    await assertFails(upload(
      testEnv.authenticatedContext('agency1'),
      'resumes/agency1/123e4567-e89b-12d3-a456-426614174000.pdf',
      'application/pdf',
    ));
  });

  it('rejects unsupported legacy types and MIME/extension mismatches', async () => {
    await seedRole('cand1', 'candidate');
    const candidate = testEnv.authenticatedContext('cand1');

    await assertFails(upload(
      candidate,
      'resumes/cand1/123e4567-e89b-12d3-a456-426614174000.doc',
      'application/msword',
    ));
    await assertFails(upload(
      candidate,
      'resumes/cand1/223e4567-e89b-12d3-a456-426614174000.pdf',
      'text/html',
    ));
    await assertFails(upload(
      candidate,
      'resumes/cand1/323e4567-e89b-12d3-a456-426614174000.png',
      'image/svg+xml',
    ));
    await assertFails(upload(candidate, 'resumes/cand1/friendly_name.pdf', 'application/pdf'));
  });

  it('enforces the 5 MiB image and 10 MiB document boundaries', async () => {
    await seedRole('cand1', 'candidate');
    const candidate = testEnv.authenticatedContext('cand1');

    await assertFails(upload(
      candidate,
      'resumes/cand1/123e4567-e89b-12d3-a456-426614174000.png',
      'image/png',
      5 * MIB,
    ));
    await assertSucceeds(upload(
      candidate,
      'resumes/cand1/223e4567-e89b-12d3-a456-426614174000.png',
      'image/png',
      5 * MIB - 1,
    ));
    await assertFails(upload(
      candidate,
      'resumes/cand1/323e4567-e89b-12d3-a456-426614174000.pdf',
      'application/pdf',
      10 * MIB,
    ));
    await assertSucceeds(upload(
      candidate,
      'resumes/cand1/423e4567-e89b-12d3-a456-426614174000.pdf',
      'application/pdf',
      10 * MIB - 1,
    ));
  });

  it('allows an owner to delete an old resume after a role change', async () => {
    await seedRole('cand1', 'candidate');
    const candidate = testEnv.authenticatedContext('cand1');
    const path = 'resumes/cand1/123e4567-e89b-12d3-a456-426614174000.pdf';
    await assertSucceeds(upload(candidate, path, 'application/pdf'));
    await seedRole('cand1', 'employer');

    await assertFails(upload(candidate, path, 'application/pdf'));
    await assertSucceeds(objectRef(candidate, path).delete());
  });
});

describe('application_resumes/{applicationId}/{fileName}', () => {
  it('denies every direct client read, create, update, and delete', async () => {
    const path = 'application_resumes/app1/resume.pdf';
    await seedObject(path, 'application/pdf');
    await seedRole('cand1', 'candidate');
    await seedRole('emp1', 'employer');

    for (const ctx of [
      testEnv.authenticatedContext('cand1'),
      testEnv.authenticatedContext('emp1'),
      testEnv.authenticatedContext('unrelated'),
      testEnv.unauthenticatedContext(),
    ]) {
      await assertFails(objectRef(ctx, path).getMetadata());
      await assertFails(upload(ctx, path, 'application/pdf'));
      await assertFails(objectRef(ctx, path).delete());
    }
  });
});

describe('path boundaries and default deny', () => {
  it('denies nested objects beneath every fixed-depth client namespace', async () => {
    await seedRole('cand1', 'candidate');
    await seedRole('emp1', 'employer');

    await assertFails(upload(
      testEnv.authenticatedContext('cand1'),
      'avatars/cand1/nested/123e4567-e89b-12d3-a456-426614174000.png',
      'image/png',
    ));
    await assertFails(upload(
      testEnv.authenticatedContext('emp1'),
      'company-logos/emp1/nested/123e4567-e89b-12d3-a456-426614174000.png',
      'image/png',
    ));
    await assertFails(upload(
      testEnv.authenticatedContext('cand1'),
      'resumes/cand1/nested/123e4567-e89b-12d3-a456-426614174000.pdf',
      'application/pdf',
    ));
  });

  it('denies unknown and look-alike top-level paths', async () => {
    const signedIn = testEnv.authenticatedContext('cand1');

    await assertFails(upload(signedIn, 'unknown/cand1/file.png', 'image/png'));
    await assertFails(upload(signedIn, 'application-resumes/app1/resume.pdf', 'application/pdf'));
    await assertFails(upload(signedIn, 'resumes-cand1/file.pdf', 'application/pdf'));
  });
});
