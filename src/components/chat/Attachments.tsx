/** Attachment tiles shared by the composer and the sent messages: image thumbnails + file cards, all previewable. */
import type { AttachedFile } from '../../types';
import { usePreview, type PreviewItem } from '../ui/Lightbox';
import { FileCodeIcon, FileTextIcon, ImageIcon, XIcon } from '../ui/Icons';

const CODE_EXT = /\.(js|ts|tsx|jsx|py|css|scss|html|json|ya?ml|xml|sh|sql|java|go|rs|c|cpp|h|php|rb|toml|ini|env)$/i;

export function fileKind(f: AttachedFile): 'image' | 'pdf' | 'code' | 'text' {
  const kind = f.kind || (f.dataUrl ? 'image' : 'text');
  if (kind === 'image') return 'image';
  if (kind === 'pdf') return 'pdf';
  return CODE_EXT.test(f.name) ? 'code' : 'text';
}

function extension(name: string) {
  const m = /\.([a-z0-9]{1,6})$/i.exec(name);
  return m ? m[1].toUpperCase() : 'TXT';
}

function fileMeta(f: AttachedFile): string {
  const k = fileKind(f);
  if (k === 'pdf') {
    const pages = f.pageCount ? `${f.pageCount} page${f.pageCount > 1 ? 's' : ''}` : '';
    const scanned = f.images?.length ? 'scanné' : '';
    return ['PDF', pages, scanned].filter(Boolean).join(' · ');
  }
  const lines = f.text ? f.text.split('\n').length : 0;
  return lines ? `${extension(f.name)} · ${lines.toLocaleString('fr-FR')} ligne${lines > 1 ? 's' : ''}` : extension(f.name);
}

/** Builds the gallery for a message's attachments and the index at which `target` starts. */
export function previewFor(files: AttachedFile[], target: number): { items: PreviewItem[]; index: number } {
  const items: PreviewItem[] = [];
  let index = 0;
  files.forEach((f, i) => {
    if (i === target) index = items.length;
    const k = fileKind(f);
    if (k === 'image' && f.dataUrl) items.push({ name: f.name, kind: 'image', src: f.dataUrl });
    else if (k === 'pdf' && f.images?.length) f.images.forEach((src, p) => items.push({ name: f.name, kind: 'image', src, caption: `Page ${p + 1}` }));
    else items.push({ name: f.name, kind: 'text', text: f.text, caption: fileMeta(f) });
  });
  return { items, index };
}

function KindIcon({ file }: { file: AttachedFile }) {
  const k = fileKind(file);
  return (
    <span className={`att-ico k-${k}`}>
      {k === 'image' ? <ImageIcon size={18} /> : k === 'code' ? <FileCodeIcon size={18} /> : <FileTextIcon size={18} />}
      {k === 'pdf' && <span className="badge">PDF</span>}
    </span>
  );
}

interface ListProps {
  files: AttachedFile[];
  /** Composer mode: compact tiles with a remove button. */
  onRemove?: (index: number) => void;
  /** Number of files still being prepared (rendered as loading tiles). */
  pending?: number;
  variant: 'composer' | 'message';
}

export function AttachmentList({ files, onRemove, pending = 0, variant }: ListProps) {
  const preview = usePreview();
  const open = (i: number) => {
    const { items, index } = previewFor(files, i);
    preview(items, index);
  };
  const images = files.filter(f => fileKind(f) === 'image').length;

  return (
    <div className={`att-list v-${variant}${variant === 'message' && images === 1 && files.length === 1 ? ' single' : ''}`}>
      {files.map((f, i) => {
        const k = fileKind(f);
        const thumb = k === 'image' ? f.dataUrl : k === 'pdf' ? f.images?.[0] : undefined;
        return (
          <div key={i} className={`att ${thumb && k === 'image' ? 'att-img' : 'att-file'}`}>
            <button className="att-open" onClick={() => open(i)} aria-label={`Aperçu de ${f.name}`} title={f.name}>
              {thumb && k === 'image' ? (
                <img src={thumb} alt={f.name} loading="lazy" decoding="async" draggable={false} />
              ) : (
                <>
                  {thumb ? <span className="att-pdf-thumb"><img src={thumb} alt="" loading="lazy" draggable={false} /></span> : <KindIcon file={f} />}
                  <span className="att-txt">
                    <span className="att-name">{f.name}</span>
                    <span className="att-meta">{fileMeta(f)}</span>
                  </span>
                </>
              )}
            </button>
            {onRemove && (
              <button className="att-x" aria-label={`Retirer ${f.name}`} onClick={() => onRemove(i)}><XIcon size={12} /></button>
            )}
          </div>
        );
      })}
      {Array.from({ length: pending }, (_, i) => (
        <div key={`p${i}`} className="att att-pending" aria-label="Préparation de la pièce jointe">
          <span className="spinner" />
        </div>
      ))}
    </div>
  );
}
