import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Markdown from 'react-markdown';
import { Bot, MessageSquarePlus, Send, Trash2, Wrench } from 'lucide-react';
import { useConversation, useConversations, useDeleteConversation, useSendChat } from '../api/hooks';
import { errorMessage } from '../api/client';
import type { ChatMessage } from '../api/types';
import { Button, PageHeader } from '../components/ui';
import { timeAgo } from '../lib/format';

const SUGGESTIONS = [
  'Give me a summary of shipment statuses',
  'Where is shipment SHP-DEMO001004?',
  'Which customers do we have at Acme?',
  'Explain the shipment lifecycle',
];

type UiMessage = ChatMessage & { pending?: boolean; failed?: boolean; tools?: string[] };

export function AssistantPage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const conversations = useConversations();
  const loaded = useConversation(conversationId);
  const send = useSendChat();
  const remove = useDeleteConversation();
  const endRef = useRef<HTMLDivElement>(null);
  // When we create a conversation ourselves, keep the local thread instead of reloading it
  const skipLoadFor = useRef<string | null>(null);

  useEffect(() => {
    if (loaded.data && skipLoadFor.current !== loaded.data.id) setMessages(loaded.data.messages);
  }, [loaded.data]);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [messages]);

  const ask = async (text: string) => {
    const message = text.trim();
    if (!message || send.isPending) return;
    setInput('');
    const tempId = `tmp-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: `${tempId}-u`, role: 'user', content: message, createdAt: new Date().toISOString() },
      { id: `${tempId}-a`, role: 'assistant', content: '', createdAt: new Date().toISOString(), pending: true },
    ]);
    try {
      const res = await send.mutateAsync({ message, conversationId: conversationId ?? undefined });
      if (!conversationId) {
        skipLoadFor.current = res.conversationId;
        setConversationId(res.conversationId);
      }
      setMessages((m) => m.map((x) => (x.id === `${tempId}-a` ? { ...res.message, tools: res.meta.toolsUsed } : x)));
    } catch (err) {
      // Graceful failure: keep the user's text, show the error inline, allow retry
      setMessages((m) => m.map((x) => (x.id === `${tempId}-a` ? { ...x, pending: false, failed: true, content: errorMessage(err) } : x)));
      setInput(message);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(input);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void ask(input);
    }
  };

  const newChat = () => {
    skipLoadFor.current = null;
    setConversationId(null);
    setMessages([]);
  };

  return (
    <>
      <PageHeader title="AI assistant" subtitle="Ask about shipments, customers and operations. Answers are grounded in live ShipOps data." />
      <div className="chat-layout">
        <aside className="card chat-history" aria-label="Conversations">
          <Button variant="secondary" icon={<MessageSquarePlus size={16} />} onClick={newChat} className="btn-block">New chat</Button>
          <ul>
            {conversations.data?.map((c) => (
              <li key={c.id} className={c.id === conversationId ? 'active' : ''}>
                <button className="conv-link" onClick={() => { skipLoadFor.current = null; setConversationId(c.id); }}>
                  <span>{c.title}</span>
                  <span className="small muted">{timeAgo(c.updatedAt)}</span>
                </button>
                <button
                  className="icon-btn danger"
                  aria-label={`Delete conversation ${c.title}`}
                  onClick={async () => {
                    await remove.mutateAsync(c.id);
                    if (c.id === conversationId) newChat();
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="card chat-main">
          <div className="chat-messages" aria-live="polite">
            {messages.length === 0 ? (
              <div className="chat-empty">
                <Bot size={32} aria-hidden />
                <p><strong>How can I help?</strong></p>
                <div className="suggestions">
                  {SUGGESTIONS.map((s) => <button key={s} className="chip-btn" onClick={() => void ask(s)}>{s}</button>)}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`bubble bubble-${m.role} ${m.failed ? 'bubble-failed' : ''}`}>
                  {m.pending ? (
                    <span className="typing" aria-label="Assistant is typing"><i /><i /><i /></span>
                  ) : m.role === 'assistant' ? (
                    <>
                      <Markdown>{m.content}</Markdown>
                      {m.tools && m.tools.length > 0 && (
                        <span className="tools-used"><Wrench size={12} aria-hidden /> looked up: {[...new Set(m.tools)].join(', ')}</span>
                      )}
                    </>
                  ) : (
                    <p>{m.content}</p>
                  )}
                </div>
              ))
            )}
            <div ref={endRef} />
          </div>
          <form className="chat-input" onSubmit={onSubmit}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about a shipment, e.g. “Where is SHP-…?”"
              rows={1}
              maxLength={4000}
              aria-label="Message"
            />
            <Button type="submit" icon={<Send size={16} />} loading={send.isPending} disabled={!input.trim()} aria-label="Send" />
          </form>
        </section>
      </div>
    </>
  );
}
