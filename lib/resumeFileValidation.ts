import { MAX_RESUME_TEXT_CHARS } from '../functions/src/utils/runtimeLimits';

export { MAX_RESUME_TEXT_CHARS } from '../functions/src/utils/runtimeLimits';

export const MAX_RESUME_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_RESUME_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_RESUME_PDF_PAGES = 8;
export const MAX_RESUME_IMAGE_BASE64_CHARS = 8_000_000;
export const MAX_RESUME_TOTAL_IMAGE_BASE64_CHARS = 8_000_000;

export const RESUME_FILE_ACCEPT = '.txt,.png,.jpg,.jpeg,.pdf,.docx';

export type ResumeFileKind = 'pdf' | 'docx' | 'text' | 'image';
export type ResumeFileValidationCode =
  | 'unsupported'
  | 'file_too_large'
  | 'image_too_large'
  | 'too_many_pdf_pages'
  | 'text_too_large'
  | 'image_payload_too_large';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
};

export const getResumeFileKind = (
  file: Pick<File, 'name' | 'type'>,
): ResumeFileKind | null => {
  const extension = extensionOf(file.name);
  const mime = (file.type || '').toLowerCase();

  // Legacy binary .doc is not supported by mammoth's browser parser. Reject it
  // even when a browser supplies a misleading MIME type.
  if (extension === 'doc') return null;
  if (extension === 'pdf') return 'pdf';
  if (extension === 'docx') return 'docx';
  if (extension === 'txt') return 'text';
  if (extension === 'png' || extension === 'jpg' || extension === 'jpeg') return 'image';

  if (mime === 'application/pdf') return 'pdf';
  if (mime === DOCX_MIME) return 'docx';
  if (mime === 'text/plain') return 'text';
  if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg') return 'image';
  return null;
};

const validationMessage = (code: ResumeFileValidationCode): string => {
  switch (code) {
    case 'unsupported':
      return 'Unsupported file type. Please upload a .txt, .png, .jpg, .pdf, or .docx file.';
    case 'file_too_large':
      return 'Resume file must be smaller than 10 MB.';
    case 'image_too_large':
      return 'Resume image must be smaller than 5 MB.';
    case 'too_many_pdf_pages':
      return `PDF resume must have no more than ${MAX_RESUME_PDF_PAGES} pages.`;
    case 'text_too_large':
      return 'The extracted resume text is too long to analyze.';
    case 'image_payload_too_large':
      return 'The scanned resume is too large to analyze. Use a smaller or text-based PDF.';
  }
};

export class ResumeFileValidationError extends Error {
  readonly code: ResumeFileValidationCode;

  constructor(code: ResumeFileValidationCode) {
    super(validationMessage(code));
    this.name = 'ResumeFileValidationError';
    this.code = code;
  }
}

/** Format-only check retained for upload/storage callers. */
export const isSupportedResumeFile = (file: Pick<File, 'name' | 'type'>): boolean =>
  getResumeFileKind(file) !== null;

export const getResumeFileValidationIssue = (
  file: Pick<File, 'name' | 'type' | 'size'>,
): ResumeFileValidationCode | null => {
  const kind = getResumeFileKind(file);
  if (!kind) return 'unsupported';
  if (file.size >= MAX_RESUME_FILE_BYTES) return 'file_too_large';
  if (kind === 'image' && file.size >= MAX_RESUME_IMAGE_BYTES) return 'image_too_large';
  return null;
};

export const assertResumeFileAccepted = (
  file: Pick<File, 'name' | 'type' | 'size'>,
): ResumeFileKind => {
  const issue = getResumeFileValidationIssue(file);
  if (issue) throw new ResumeFileValidationError(issue);
  return getResumeFileKind(file) as ResumeFileKind;
};

export const assertResumePdfPageCount = (pageCount: number): void => {
  if (!Number.isFinite(pageCount) || pageCount < 1 || pageCount > MAX_RESUME_PDF_PAGES) {
    throw new ResumeFileValidationError('too_many_pdf_pages');
  }
};

export const assertResumeTextLength = (text: string): void => {
  if (text.length > MAX_RESUME_TEXT_CHARS) {
    throw new ResumeFileValidationError('text_too_large');
  }
};

export const assertResumeImagePayload = (base64Lengths: number[]): void => {
  const invalidPart = base64Lengths.some(
    (length) => !Number.isFinite(length) || length <= 0 || length > MAX_RESUME_IMAGE_BASE64_CHARS,
  );
  const total = base64Lengths.reduce((sum, length) => sum + length, 0);
  if (invalidPart || total > MAX_RESUME_TOTAL_IMAGE_BASE64_CHARS) {
    throw new ResumeFileValidationError('image_payload_too_large');
  }
};
