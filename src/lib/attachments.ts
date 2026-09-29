import type { AttachedFile } from '../types';

const MAX_TEXT_BYTES = 1_000_000;
const MAX_IMAGE_BYTES = 12_000_000;
const MAX_PDF_BYTES = 20_000_000;
const MAX_IMAGE_EDGE = 1536;
const MAX_PDF_TEXT_PAGES = 30;
const MAX_SCANNED_PAGES = 3;

export const ATTACHMENT_ACCEPT = [
  'image/*',
  'application/pdf',
  '.pdf',
  '.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', '.py',
  '.css', '.scss', '.html', '.csv', '.log', '.yaml', '.yml', '.xml',
  '.sh', '.sql', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.php',
  '.rb', '.toml', '.ini', '.env',
  'text/*',
].join(',');

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Lecture du fichier impossible'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.82): Promise<string> {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) return canvas.toDataURL('image/jpeg', quality);
  return blobToDataUrl(blob);
}

async function prepareImage(file: File): Promise<AttachedFile> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Image trop volumineuse (12 Mo max).');

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponible');
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return {
      name: file.name,
      kind: 'image',
      mimeType: 'image/jpeg',
      dataUrl: await canvasToJpeg(canvas),
    };
  } catch {
    // Fallback for image formats createImageBitmap cannot decode on a device.
    return {
      name: file.name,
      kind: 'image',
      mimeType: file.type || 'image/*',
      dataUrl: await blobToDataUrl(file),
    };
  }
}

async function loadPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

async function renderPdfPage(page: any): Promise<string> {
  const raw = page.getViewport({ scale: 1 });
  const scale = Math.min(1.35, MAX_IMAGE_EDGE / Math.max(raw.width, raw.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvasToJpeg(canvas, 0.8);
}

async function preparePdf(file: File): Promise<AttachedFile> {
  if (file.size > MAX_PDF_BYTES) throw new Error('PDF trop volumineux (20 Mo max).');

  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;

  try {
    const pagesToRead = Math.min(doc.numPages, MAX_PDF_TEXT_PAGES);
    const pageTexts: string[] = [];

    for (let i = 1; i <= pagesToRead; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const text = tc.items
        .map((item: any) => ('str' in item ? String(item.str) : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) pageTexts.push(`--- Page ${i} ---\n${text}`);
    }

    const text = pageTexts.join('\n\n').trim();
    const meaningfulText = text.replace(/\s/g, '').length >= 80;

    if (meaningfulText) {
      return {
        name: file.name,
        kind: 'pdf',
        mimeType: 'application/pdf',
        text,
        pageCount: doc.numPages,
      };
    }

    // Scanned/image-only PDF: render a few pages and let the vision model read them.
    const images: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, MAX_SCANNED_PAGES); i++) {
      images.push(await renderPdfPage(await doc.getPage(i)));
    }

    return {
      name: file.name,
      kind: 'pdf',
      mimeType: 'application/pdf',
      text: `PDF scanné de ${doc.numPages} page(s). ${images.length < doc.numPages ? `Les ${images.length} premières pages sont jointes comme images.` : ''}`.trim(),
      images,
      pageCount: doc.numPages,
    };
  } finally {
    await loadingTask.destroy();
  }
}

async function prepareText(file: File): Promise<AttachedFile> {
  if (file.size > MAX_TEXT_BYTES) throw new Error('Fichier texte trop volumineux (1 Mo max).');
  return {
    name: file.name,
    kind: 'text',
    mimeType: file.type || 'text/plain',
    text: await file.text(),
  };
}

export async function prepareAttachment(file: File): Promise<AttachedFile> {
  if (file.type.startsWith('image/')) return prepareImage(file);
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return preparePdf(file);

  const textLike = file.type.startsWith('text/') || /\.(txt|md|json|js|ts|tsx|jsx|py|css|scss|html|csv|log|ya?ml|xml|sh|sql|java|go|rs|c|cpp|h|php|rb|toml|ini|env)$/i.test(file.name);
  if (textLike) return prepareText(file);

  throw new Error('Format non pris en charge. Utilisez une image, un PDF ou un fichier texte/code.');
}
