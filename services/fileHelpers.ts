import mammoth from 'mammoth';
import { getDocument, GlobalWorkerOptions, type PageViewport } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ResumeImage } from '../types';
import {
    assertResumeFileAccepted,
    assertResumeImagePayload,
    assertResumePdfPageCount,
    assertResumeTextLength,
    ResumeFileValidationError,
} from '../lib/resumeFileValidation';

// Bundle the worker with the app so PDF parsing does not depend on a third-party CDN.
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ParsedFile {
    text: string;
    images?: ResumeImage[];
}

export const parseFile = async (file: File): Promise<ParsedFile> => {
    try {
        const kind = assertResumeFileAccepted(file);

        if (kind === 'pdf') {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await getDocument(arrayBuffer).promise;
            try {
                // Check before walking or rasterizing pages. The callable accepts at
                // most eight images, so a ninth page can never produce a valid run.
                assertResumePdfPageCount(pdf.numPages);
                let fullText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    fullText += textContent.items.map((item: any) => 'str' in item ? item.str : '').join(' ') + '\n';
                }

                if (fullText.trim().length < 250) {
                    // Sparse/scanned PDFs use the multimodal path. Keep the render
                    // bounded so the callable payload remains below its input limit.
                    const images: ResumeImage[] = [];
                    const payloadLengths: number[] = [];
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const viewport: PageViewport = page.getViewport({ scale: 1.5 });
                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d');
                        if (!context) continue;

                        canvas.height = viewport.height;
                        canvas.width = viewport.width;

                        await page.render({ canvasContext: context, viewport, canvas } as any).promise;

                        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
                        const base64Data = dataUrl.split(',')[1];
                        if (base64Data) {
                            payloadLengths.push(base64Data.length);
                            assertResumeImagePayload(payloadLengths);
                            images.push({ mimeType: 'image/jpeg', data: base64Data });
                        }
                    }
                    if (images.length > 0) {
                        return { text: '', images };
                    }
                    throw new Error('Could not extract text or images from PDF.');
                }
                assertResumeTextLength(fullText);
                return { text: fullText };
            } finally {
                await pdf.destroy();
            }

        } else if (kind === 'text') {
            const text = await file.text();
            assertResumeTextLength(text);
            return { text };

        } else if (kind === 'image') {
            const base64String = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = (error) => reject(error);
                reader.readAsDataURL(file);
            });
            const base64Data = base64String.split(',')[1];
            if (base64Data) {
                assertResumeImagePayload([base64Data.length]);
                const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
                return { text: '', images: [{ mimeType, data: base64Data }] };
            }
            throw new Error('Could not read the image file.');

        } else if (kind === 'docx') {
            const arrayBuffer = await file.arrayBuffer();
            const { value } = await mammoth.extractRawText({ arrayBuffer });
            assertResumeTextLength(value);
            return { text: value };
        }

        throw new ResumeFileValidationError('unsupported');
    } catch (error) {
        if (!(error instanceof ResumeFileValidationError)) {
            console.error('Error parsing file:', error);
        }
        throw error;
    }
};
