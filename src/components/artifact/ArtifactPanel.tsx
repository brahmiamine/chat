import { useEffect, useMemo, useState } from 'react';
import type { Artifact, ArtifactFile, Conversation } from '../../types';
import { hasPreview, mimeOf } from '../../lib/artifacts';
import { diffLines } from '../../lib/diff';
import { downloadText, downloadBlob, zipFiles } from '../../lib/download';
import { highlightToHtml } from '../../lib/highlight';
import { useCopy } from '../../hooks/useCopy';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, DownloadIcon, PencilIcon, XIcon, ZoomInIcon, ZoomOutIcon } from '../ui/Icons';
import { ArtifactPreview } from './ArtifactPreview';

interface Props {
  conversation: Conversation;
  artifactId: string;
  isMobile: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onSaveEdit: (artifactId: string, files: ArtifactFile[]) => void;
  onRestore: (artifactId: string, versionIndex: number) => void;
  onFix: (prompt: string) => void;
}

type Tab = 'preview' | 'code' | 'diff';

const SOURCE_LABEL = { assistant: 'générée', edit: 'modifiée à la main', restore: 'restaurée' } as const;

function FileDiff({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  if (!lines) return <div className="data-error">Fichiers trop grands pour la comparaison.</div>;
  const changed = lines.some(l => l.type !== 'same');
  if (!changed) return <div className="diff-empty">Aucune modification.</div>;
  // Only changed lines with 2 lines of context.
  const keep = lines.map((l, i) => l.type !== 'same' || lines.slice(Math.max(0, i - 2), i + 3).some(x => x.type !== 'same'));
  return (
    <pre className="diff">
      {lines.map((l, i) => (keep[i]
        ? <div key={i} className={`diff-line ${l.type}`}>{l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}{l.text}</div>
        : (keep[i - 1] ? <div key={i} className="diff-line gap">⋯</div> : null)))}
    </pre>
  );
}

export function ArtifactPanel({ conversation, artifactId, isMobile, onClose, onSelect, onSaveEdit, onRestore, onFix }: Props) {
  const artifacts = conversation.artifacts || [];
  const artifact: Artifact | undefined = artifacts.find(a => a.id === artifactId);
  const count = artifact?.versions.length || 0;
  const [index, setIndex] = useState(count - 1);
  const [tab, setTab] = useState<Tab>(artifact && hasPreview(artifact.kind) ? 'preview' : 'code');
  const [fileIdx, setFileIdx] = useState(0);
  const [draft, setDraft] = useState<ArtifactFile[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const { copied, copy } = useCopy();

  // A new version (from the assistant or an edit) becomes the one shown.
  useEffect(() => { setIndex(count - 1); setDraft(null); }, [artifactId, count]);

  if (!artifact) return null;
  const version = artifact.versions[Math.min(index, count - 1)];
  const files = version.files;
  const file = files[Math.min(fileIdx, files.length - 1)];
  const previous = index > 0 ? artifact.versions[index - 1] : null;
  const isLatest = index === count - 1;

  const download = () => {
    if (files.length === 1) downloadText(file.name, file.code, mimeOf(file.name));
    else downloadBlob(`${artifact.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'artefact'}.zip`, zipFiles(files.map(f => ({ name: f.name, text: f.code }))));
  };
  const fix = (errors: string[]) => onFix(
    `L’artefact « ${artifact.title} » (version ${index + 1}) affiche ces erreurs dans la console. Corrige-le et renvoie les fichiers complets :\n\`\`\`\n${errors.join('\n')}\n\`\`\``,
  );

  return (
    <aside className={`artifact-panel${isMobile ? ' mobile' : ''}${expanded ? ' expanded' : ''}`} aria-label="Artefact">
      <div className="ap-head">
        <div className="ap-title">
          {artifacts.length > 1 ? (
            <select value={artifact.id} onChange={e => onSelect(e.target.value)} aria-label="Choisir un artefact">
              {artifacts.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
            </select>
          ) : <span className="ap-name">{artifact.title}</span>}
          <div className="ap-versions">
            <button className="icon-btn ghost" aria-label="Version précédente" disabled={index === 0} onClick={() => setIndex(i => i - 1)}><ChevronLeftIcon size={16} /></button>
            <span title={SOURCE_LABEL[version.source]}>v{index + 1}/{count}</span>
            <button className="icon-btn ghost" aria-label="Version suivante" disabled={isLatest} onClick={() => setIndex(i => i + 1)}><ChevronRightIcon size={16} /></button>
          </div>
        </div>
        <div className="ap-actions">
          <button className="icon-btn ghost" aria-label={files.length > 1 ? 'Télécharger le projet (ZIP)' : 'Télécharger'} title={files.length > 1 ? 'Télécharger le projet (ZIP)' : `Télécharger ${file.name}`} onClick={download}><DownloadIcon size={17} /></button>
          {!isMobile && (
            <button className="icon-btn ghost" aria-label={expanded ? 'Réduire' : 'Plein écran'} onClick={() => setExpanded(e => !e)}>
              {expanded ? <ZoomOutIcon size={17} /> : <ZoomInIcon size={17} />}
            </button>
          )}
          <button className="icon-btn ghost" aria-label="Fermer l’artefact" onClick={onClose}><XIcon /></button>
        </div>
      </div>

      <div className="ap-tabs" role="tablist">
        {hasPreview(artifact.kind) && <button role="tab" aria-selected={tab === 'preview'} className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>Aperçu</button>}
        <button role="tab" aria-selected={tab === 'code'} className={tab === 'code' ? 'on' : ''} onClick={() => setTab('code')}>Code</button>
        {previous && <button role="tab" aria-selected={tab === 'diff'} className={tab === 'diff' ? 'on' : ''} onClick={() => setTab('diff')}>Modifications</button>}
        {!isLatest && (
          <button className="ap-restore" onClick={() => onRestore(artifact.id, index)}>Restaurer cette version</button>
        )}
      </div>

      <div className="ap-body">
        {tab === 'preview' && (
          <ArtifactPreview key={version.id} kind={artifact.kind} files={files} sizes={!isMobile} onFix={isLatest ? fix : undefined} className="panel" />
        )}

        {tab === 'code' && (
          <div className="ap-code">
            <div className="ap-files">
              {files.length > 1 && files.map((f, i) => (
                <button key={f.name} className={i === fileIdx ? 'on' : ''} onClick={() => setFileIdx(i)}>{f.name}</button>
              ))}
              <div className="ap-code-actions">
                {draft ? (
                  <>
                    <button className="btn-outline sm" onClick={() => setDraft(null)}>Annuler</button>
                    <button className="btn-solid sm" onClick={() => { onSaveEdit(artifact.id, draft); setDraft(null); }}>Enregistrer (v{count + 1})</button>
                  </>
                ) : (
                  <>
                    <button className="btn-outline sm" onClick={() => setDraft(files.map(f => ({ ...f })))}><PencilIcon size={14} />Modifier</button>
                    <button className="btn-outline sm" onClick={() => copy(file.code)}>{copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}{copied ? 'Copié' : 'Copier'}</button>
                  </>
                )}
              </div>
            </div>
            {draft ? (
              <textarea
                className="ap-editor"
                spellCheck={false}
                value={draft[Math.min(fileIdx, draft.length - 1)].code}
                onChange={e => setDraft(d => d && d.map((f, i) => (i === Math.min(fileIdx, d.length - 1) ? { ...f, code: e.target.value } : f)))}
              />
            ) : (
              <pre className="ap-pre"><code dangerouslySetInnerHTML={{ __html: highlightToHtml(file.code, file.lang) }} /></pre>
            )}
          </div>
        )}

        {tab === 'diff' && previous && (
          <div className="ap-diff">
            <div className="s-help">Version {index} → version {index + 1} ({SOURCE_LABEL[version.source]})</div>
            {files.map(f => (
              <div key={f.name}>
                {files.length > 1 && <div className="diff-file">{f.name}</div>}
                <FileDiff before={previous.files.find(p => p.name === f.name)?.code || ''} after={f.code} />
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
