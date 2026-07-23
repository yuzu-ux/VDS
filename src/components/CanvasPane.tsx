import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ElementComment, ProjectFile } from '../../shared/types';
import { vds } from '../bridge';

const FRAME_W = 1280;

/** Script injected into previews so comment mode can target elements. */
const BRIDGE = `<script>(function(){
  var on = false;
  window.addEventListener('message', function(e){
    if (e.data && e.data.type === 'vds-comment-mode') {
      on = !!e.data.on;
      document.documentElement.classList.toggle('vds-commenting', on);
    }
  });
  var style = document.createElement('style');
  style.textContent = '.vds-commenting [data-vds-id]:hover{outline:2px solid #c15f3c;outline-offset:2px;cursor:crosshair}.vds-commenting *{cursor:crosshair!important}';
  document.head.appendChild(style);
  document.addEventListener('click', function(e){
    if (!on) return;
    e.preventDefault(); e.stopPropagation();
    var el = e.target;
    var target = el && el.closest ? el.closest('[data-vds-id]') : null;
    var selector = target ? '[data-vds-id="' + target.getAttribute('data-vds-id') + '"]' : (el && el.tagName ? el.tagName.toLowerCase() : 'body');
    var label = ((el && el.textContent) || '').trim().slice(0, 48);
    parent.postMessage({ type: 'vds-comment-click', selector: selector, label: label, x: e.clientX, y: e.clientY }, '*');
  }, true);
})();</script>`;

function injectBridge(html: string): string {
  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx >= 0) return html.slice(0, idx) + BRIDGE + html.slice(idx);
  return html + BRIDGE;
}

export function CanvasPane(props: {
  projectId: string;
  files: ProjectFile[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  refreshTick: number;
  onManualRefresh: () => void;
  commentMode: boolean;
  onToggleCommentMode: () => void;
  onAddComment: (c: ElementComment) => void;
  deckMode: boolean;
}) {
  const {
    projectId, files, activeFile, onSelectFile, refreshTick, onManualRefresh,
    commentMode, onToggleCommentMode, onAddComment, deckMode,
  } = props;

  const [content, setContent] = useState<string>('');
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const [pendingNote, setPendingNote] = useState<{ selector: string; label: string; left: number; top: number } | null>(null);
  const [noteText, setNoteText] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const viewportRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const previewables = useMemo(() => files.filter((f) => f.previewable), [files]);
  const frameH = deckMode ? 800 : 860;

  // load active file content
  useEffect(() => {
    if (!activeFile) {
      setContent('');
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      void vds()
        .readFile(projectId, activeFile)
        .then((text) => alive && setContent(text))
        .catch(() => alive && setContent(''));
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [projectId, activeFile, refreshTick]);

  // fit-to-width
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setFitScale(Math.min(1, (el.clientWidth - 48) / FRAME_W));
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const scale = zoom === 'fit' ? fitScale : zoom;

  // comment mode → tell the iframe
  const pushCommentMode = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'vds-comment-mode', on: commentMode }, '*');
  }, [commentMode]);

  useEffect(() => {
    pushCommentMode();
    if (!commentMode) setPendingNote(null);
  }, [pushCommentMode]);

  // listen for element clicks from the preview
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (!e.data || e.data.type !== 'vds-comment-click') return;
      const viewport = viewportRef.current;
      const iframe = iframeRef.current;
      if (!viewport || !iframe) return;
      const vRect = viewport.getBoundingClientRect();
      const fRect = iframe.getBoundingClientRect();
      const left = fRect.left - vRect.left + viewport.scrollLeft + Number(e.data.x ?? 0) * scale;
      const top = fRect.top - vRect.top + viewport.scrollTop + Number(e.data.y ?? 0) * scale;
      setPendingNote({
        selector: String(e.data.selector ?? 'body'),
        label: String(e.data.label ?? ''),
        left: Math.min(Math.max(8, left), viewport.scrollLeft + viewport.clientWidth - 300),
        top: Math.max(8, top),
      });
      setNoteText('');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [scale]);

  const saveNote = () => {
    if (!pendingNote || !noteText.trim()) return;
    onAddComment({ selector: pendingNote.selector, elementLabel: pendingNote.label, note: noteText.trim() });
    setPendingNote(null);
    setNoteText('');
  };

  const doExport = async (kind: 'html' | 'pdf') => {
    if (!activeFile || exporting) return;
    setExporting(kind);
    try {
      const res = kind === 'html' ? await vds().exportHtml(projectId, activeFile) : await vds().exportPdf(projectId, activeFile);
      void res;
    } finally {
      setExporting(null);
    }
  };

  const srcdoc = useMemo(() => (content ? injectBridge(content) : ''), [content]);

  return (
    <section className="canvas-pane">
      <div className="canvas-tabs">
        <span className="eyebrow" style={{ marginRight: 6 }}>Design files</span>
        {previewables.map((f) => (
          <button key={f.path} className={`file-tab ${f.path === activeFile ? 'active' : ''}`} onClick={() => onSelectFile(f.path)}>
            {f.path}
          </button>
        ))}
        {previewables.length === 0 && <span style={{ color: 'var(--faint)', fontSize: 12 }}>no files yet</span>}
      </div>

      <div className="canvas-toolbar">
        <div className="seg">
          <button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>Preview</button>
          <button className={mode === 'source' ? 'active' : ''} onClick={() => setMode('source')}>Source</button>
        </div>
        <button className="btn small" onClick={onManualRefresh} title="Reload preview">↻</button>
        <button
          className={`btn small ${commentMode ? 'primary' : ''}`}
          onClick={onToggleCommentMode}
          disabled={mode !== 'preview' || !content}
          title="Click elements in the preview to pin change requests"
        >
          ✎ Comment
        </button>
        <div className="spacer" />
        <div className="seg">
          <button className={zoom === 'fit' ? 'active' : ''} onClick={() => setZoom('fit')}>Fit</button>
          <button className={zoom === 0.5 ? 'active' : ''} onClick={() => setZoom(0.5)}>50%</button>
          <button className={zoom === 0.75 ? 'active' : ''} onClick={() => setZoom(0.75)}>75%</button>
          <button className={zoom === 1 ? 'active' : ''} onClick={() => setZoom(1)}>100%</button>
        </div>
        <span className="zoom-label">{Math.round(scale * 100)}%</span>
        <button className="btn small" onClick={() => void doExport('html')} disabled={!activeFile || !!exporting}>
          {exporting === 'html' ? 'Exporting…' : 'Export HTML'}
        </button>
        <button className="btn primary small" onClick={() => void doExport('pdf')} disabled={!activeFile || !!exporting}>
          {exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}
        </button>
      </div>

      {mode === 'source' ? (
        <div className="source-view">{content || 'No file selected.'}</div>
      ) : (
        <div className="canvas-viewport" ref={viewportRef}>
          {commentMode && <div className="comment-banner">Comment mode — click an element in the preview to pin a note</div>}
          {content ? (
            <div className="canvas-frame-wrap" style={{ width: FRAME_W * scale, height: frameH * scale }}>
              <iframe
                ref={iframeRef}
                title="preview"
                sandbox="allow-scripts"
                srcDoc={srcdoc}
                style={{ width: FRAME_W, height: frameH, transform: `scale(${scale})`, transformOrigin: 'top left' }}
                onLoad={pushCommentMode}
              />
            </div>
          ) : (
            <div className="canvas-empty">
              <div className="big">Nothing here yet.</div>
              <div>Describe the design you want in the chat — files appear here as your agent writes them.</div>
            </div>
          )}
          {pendingNote && (
            <div className="note-pop" style={{ left: pendingNote.left, top: pendingNote.top }}>
              <div className="target">
                {pendingNote.selector}
                {pendingNote.label ? ` — “${pendingNote.label}”` : ''}
              </div>
              <textarea
                autoFocus
                placeholder="What should change here?"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    saveNote();
                  }
                  if (e.key === 'Escape') setPendingNote(null);
                }}
              />
              <div className="row">
                <button className="btn small" onClick={() => setPendingNote(null)}>Cancel</button>
                <button className="btn primary small" onClick={saveNote} disabled={!noteText.trim()}>Pin comment</button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
