import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import { useAuth } from '../../auth/useAuth';
import { ApiError } from '../../lib/api';
import { sendChat } from './api';
import { canUseAssistant } from './permissions';
import type { AssistantChatMessage } from './types';
import './assistant.css';

/** Starter prompts shown on an empty conversation — one tap to a useful answer. */
const SUGGESTIONS = [
  "What's our occupancy today?",
  'Any VIP guests arriving today?',
  "What's our ADR and RevPAR this month?",
  'How many rooms are free this week?',
];

const GREETING =
  "Hi! I'm your property assistant. Ask me about today's arrivals, occupancy, " +
  'housekeeping, maintenance or unsettled folios. I can read the live data — ' +
  'I just can\u2019t make changes.';

/**
 * The in-app AI assistant: a floating launcher (bottom-right) that opens a
 * slide-in chat drawer. Available on any property-scoped screen (it reads the
 * `:propertyId` route param); it renders nothing off a property page or for a
 * user without `dashboard:read`. Read-only — it only ever POSTs the
 * conversation and renders the reply.
 */
export function AssistantWidget() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  // Focus the input when the drawer opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Nothing to scope a conversation to, or no permission → render nothing.
  if (!propertyId || !canUseAssistant(session)) {
    return null;
  }

  async function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending || !propertyId) return;

    const next: AssistantChatMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(next);
    setInput('');
    setError(null);
    setSending(true);
    try {
      // Send a bounded tail of the conversation (the backend also caps it).
      const res = await sendChat(propertyId, next.slice(-19));
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(input);
  }

  return (
    <>
      <button
        type="button"
        className="assistant-fab"
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" />
          </svg>
        )}
      </button>

      {open && (
        <section className="assistant-drawer" role="dialog" aria-label="Property assistant">
          <header className="assistant-head">
            <span className="assistant-head-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5 19 19M19 5l-2.5 2.5M7.5 16.5 5 19" />
              </svg>
            </span>
            <div className="assistant-head-text">
              <span className="assistant-head-title">Property Assistant</span>
              <span className="assistant-head-sub">AI · read-only · live data</span>
            </div>
            <button type="button" className="assistant-head-close" aria-label="Close" onClick={() => setOpen(false)}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </header>

          <div className="assistant-body" ref={scrollRef}>
            <div className="assistant-msg assistant-msg-bot">
              <p>{GREETING}</p>
            </div>

            {messages.length === 0 && (
              <div className="assistant-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="assistant-suggestion" onClick={() => void submit(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={`assistant-msg ${m.role === 'user' ? 'assistant-msg-user' : 'assistant-msg-bot'}`}
              >
                {m.content.split('\n').map((line, j) => (
                  <p key={j}>{line}</p>
                ))}
              </div>
            ))}

            {sending && (
              <div className="assistant-msg assistant-msg-bot assistant-typing" aria-live="polite">
                <span className="assistant-dot" />
                <span className="assistant-dot" />
                <span className="assistant-dot" />
              </div>
            )}

            {error && (
              <p className="assistant-error" role="alert">
                {error}
              </p>
            )}
          </div>

          <form className="assistant-input" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about this property…"
              aria-label="Message the assistant"
              disabled={sending}
            />
            <button type="submit" className="assistant-send" disabled={sending || !input.trim()} aria-label="Send">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
              </svg>
            </button>
          </form>
        </section>
      )}
    </>
  );
}
