import { describe, expect, it } from 'vitest';
import {
  assertResumeImagePayload,
  assertResumePdfPageCount,
  getResumeFileKind,
  getResumeFileValidationIssue,
  MAX_RESUME_FILE_BYTES,
  MAX_RESUME_IMAGE_BYTES,
  MAX_RESUME_PDF_PAGES,
  RESUME_FILE_ACCEPT,
} from '../lib/resumeFileValidation';

const fileLike = (name: string, type: string, size = 1000) => ({ name, type, size });

describe('resume file validation', () => {
  it('accepts the formats the parser actually supports', () => {
    expect(getResumeFileKind(fileLike('resume.PDF', ''))).toBe('pdf');
    expect(getResumeFileKind(fileLike('resume', 'application/pdf'))).toBe('pdf');
    expect(getResumeFileKind(fileLike('resume.docx', ''))).toBe('docx');
    expect(getResumeFileKind(fileLike('resume.jpeg', 'image/jpeg'))).toBe('image');
  });

  it('does not advertise or accept legacy .doc files', () => {
    expect(RESUME_FILE_ACCEPT.split(',')).not.toContain('.doc');
    expect(getResumeFileValidationIssue(fileLike('resume.doc', 'application/msword'))).toBe('unsupported');
  });

  it('rejects files and direct images before expensive parsing', () => {
    expect(getResumeFileValidationIssue(fileLike('resume.pdf', 'application/pdf', MAX_RESUME_FILE_BYTES)))
      .toBe('file_too_large');
    expect(getResumeFileValidationIssue(fileLike('scan.jpg', 'image/jpeg', MAX_RESUME_IMAGE_BYTES)))
      .toBe('image_too_large');
  });

  it('enforces the callable eight-page limit before PDF rasterization', () => {
    expect(() => assertResumePdfPageCount(MAX_RESUME_PDF_PAGES)).not.toThrow();
    expect(() => assertResumePdfPageCount(MAX_RESUME_PDF_PAGES + 1)).toThrow(/8 pages/);
  });

  it('bounds the aggregate base64 image payload', () => {
    expect(() => assertResumeImagePayload([2_000_000, 2_000_000])).not.toThrow();
    expect(() => assertResumeImagePayload([5_000_000, 4_000_000])).toThrow(/too large/i);
  });
});
