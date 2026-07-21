import { useEffect, useMemo, useRef, useState } from 'react';
import type { ElementComment, EngineEvent, TodoItem, TranscriptEntry } from '../../shared/types';

type Block =
  | { kind: 'user'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; detail: string; state: 'running' | 'done' | 'error' }
  | { kind: 'todos'; items: TodoItem[] }
  | { kind: 'result'; summary: string; durationMs?: number; costUsd?: number; dedupe: boolean }
  | { kind: 'error'; text: string }
  | { kind: 'raw'; text: string };

/** Fold the flat transcript (persisted + live) into renderable blocks. */
function buildBlocks(entries: TranscriptEntry[]): Block[] {
  const blocks: Block[] = [];
  let todoIdx: number | null = null;
  const toolIdx = new Map<string, number>();

  const lastTexts = () =>
    blocks
      .filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
      .slice(-2)
      .map((b) => b.text.trim());

  for (const entry of entries) {
    if (entry.kind === 'user') {
      blocks.push({ kind: 'user', text: entry.text });
      todoIdx = null;
      toolIdx.clear();
      continue;
    }
    const event: EngineEvent = entry.event;
    switch (event.type) {
      case 'assistant-text':
        blocks.push({ kind: 'text', text: event.text });
        break;
      case 'tool': {
        const existing = toolIdx.get(event.id);
        if (existing !== undefined && blocks[existing]?.kind === 'tool') {
          const prev = blocks[existing] as Extract<Block, { kind: 'tool' }>;
          blocks[existing] = { ...prev, state: event.state, detail: event.detail || prev.detail };
        } else {
          toolIdx.set(event.id, blocks.length);
          blocks.push({ kind: 'tool', id: event.id, name: event.name, detail: event.detail, state: event.state });
        }
        break;
      }
      case 'todos':
        if (todoIdx !== null && blocks[todoIdx]?.kind === 'todos') {
          blocks[todoIdx] = { kind: 'todos', items: event.items };
        } else {
          todoIdx = blocks.length;
          blocks.push({ kind: 'todos', items: event.items });
        }
        break;
      case 'result': {
        const dedupe = event.summary.trim().length === 0 || lastTexts().includes(event.summary.trim());
        blocks.push({ kind: 'result', summary: event.summary, durationMs: event.durationMs, costUsd: event.costUsd, dedupe });
        break;
      }
      case 'status':
        if (event.state === 'error') blocks.push({ kind: 'error', text: event.detail ?? 'Run failed' });
        break;
      case 'raw': {
        const last = blocks[blocks.length - 1];
        if (last?.kind === 'raw') last.text += '\n' + event.text;
        else blocks.push({ kind: 'raw', text: event.text });
        break;
      }
      default:
        break;
    }
  }
  return blocks;
}

export function ChatPane(props: {
  entries: TranscriptEntry[];
  running: boolean;
  runStartedAt: number | null;
  engineName: string | null;
  comments: ElementComment[];
  onRemoveComment: (index: number) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const { entries, running, runStartedAt, engineName, comments, onRemoveComment, onSend, onStop } = props;
  const blocks = useMemo(() => buildBlocks(entries), [entries]);
  const [draft, setDraft] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!running || !runStartedAt) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - runStartedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running, runStartedAt]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [blocks.length, running]);

  const send = () => {
    const text = draft.trim();
    if (!text || running) return;
    setDraft('');
    onSend(text);
  };

  return (
    <aside className="chat-pane">
      <div className="chat-tabs">
        <button className="tab active">Chat</button>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {blocks.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '8px 4px' }}>
            Describe the design you want. Your agent will propose directions, build real files, and preview them on the right.
          </div>
        )}
        {blocks.map((block, i) => (
          <BlockView key={i} block={block} />
        ))}
        {running && (
          <div className="status-line">
            <span className="pulse" />
            Working{engineName ? ` · ${engineName}` : ''} · {formatElapsed(elapsed)}
          </div>
        )}
      </div>

      <div className="composer">
        {comments.length > 0 && (
          <div className="comment-pills">
            {comments.map((c, i) => (
              <span className="comment-pill" key={i} title={c.note}>
                {c.selector}
                <button onClick={() => onRemoveComment(i)}>✕</button>
              </span>
            ))}
          </div>
        )}
        <textarea
          placeholder="Describe the design you want — or pin comments on elements and ask for changes…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="row">
          <span className="hint">Enter to send · Shift+Enter for a new line</span>
          <div style={{ flex: 1 }} />
          {running ? (
            <button className="btn small" onClick={onStop}>■ Stop</button>
          ) : (
            <button className="btn primary small" onClick={send} disabled={!draft.trim()}>
              Send
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'user':
      return <div className="msg-user">{block.text}</div>;
    case 'text':
      return <div className="msg-assistant">{block.text}</div>;
    case 'tool':
      return (
        <div className="tool-chip">
          <span className="name">{block.name}</span>
          <span className="detail">{block.detail}</span>
          <span className={`state ${block.state}`}>
            {block.state === 'running' ? '●' : block.state === 'done' ? '✓' : '✕'}
          </span>
        </div>
      );
    case 'todos': {
      const done = block.items.filter((t) => t.state === 'completed').length;
      return (
        <div className="todo-card">
          <div className="head">
            <span>TODOS</span>
            <span>
              {done}/{block.items.length}
            </span>
          </div>
          <ul>
            {block.items.map((t, i) => (
              <li key={i} className={t.state}>
                <span className="mark">{t.state === 'completed' ? '✓' : t.state === 'in_progress' ? '●' : '○'}</span>
                {t.text}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case 'result':
      return (
        <>
          {!block.dedupe && block.summary && <div className="msg-assistant">{block.summary}</div>}
          <div className="result-line">
            ✓ done
            {block.durationMs ? ` · ${Math.round(block.durationMs / 1000)}s` : ''}
            {typeof block.costUsd === 'number' ? ` · $${block.costUsd.toFixed(3)}` : ''}
          </div>
        </>
      );
    case 'error':
      return <div className="status-line error">✕ {block.text}</div>;
    case 'raw':
      return (
        <div className="msg-assistant" style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
          {block.text}
        </div>
      );
    default:
      return null;
  }
}

function formatElapsed(s: number): string {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
