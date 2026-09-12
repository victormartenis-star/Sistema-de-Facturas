'use client';

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { copilotoApi, type CopilotoMessage } from '@/lib/api';
import { IconSparkles, IconX, IconLoader } from './icons';

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  error?: boolean;
}

const SUGGESTED = [
  '¿Cuánto hemos certificado en total?',
  '¿Qué obras están en curso?',
  '¿Cuánto tenemos pendiente de cobro?',
  '¿Cuáles son los pedidos emitidos?',
];

export function Copiloto() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  async function send(question: string) {
    if (!question.trim() || loading) return;
    const userMsg: ChatMsg = { role: 'user', content: question };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    const history: CopilotoMessage[] = messages
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await copilotoApi.query(question, history);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: res.answer, toolsUsed: res.toolsUsed },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: (err as Error).message ?? 'Error al consultar el copiloto.',
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <>
      {/* Botón flotante */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Abrir copiloto IA"
        className={`fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-xl transition-all ${
          open
            ? 'bg-gray-800 text-white'
            : 'bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-amber-500/30 hover:shadow-amber-500/50'
        }`}
      >
        {open ? <IconX size={22} /> : <IconSparkles size={22} />}
      </button>

      {/* Panel de chat */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl">
          {/* Cabecera */}
          <div className="flex items-center gap-3 rounded-t-2xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-3 text-white">
            <IconSparkles size={18} />
            <div className="flex-1">
              <p className="text-sm font-semibold">Copiloto ERP</p>
              <p className="text-xs text-amber-100">Pregunta sobre tus obras, facturas o tesorería</p>
            </div>
            <button onClick={() => setMessages([])} title="Limpiar conversación" className="rounded p-1 hover:bg-white/20">
              <span className="text-xs">↺</span>
            </button>
          </div>

          {/* Mensajes */}
          <div className="flex h-80 flex-col gap-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-center text-xs text-gray-400">
                  Haz una pregunta o elige una sugerencia:
                </p>
                <div className="flex flex-col gap-1.5">
                  {SUGGESTED.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-left text-xs text-gray-700 hover:border-amber-300 hover:bg-amber-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-amber-500 text-white'
                      : msg.error
                        ? 'bg-red-50 text-red-700'
                        : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                    <p className="mt-1 text-[10px] text-gray-400">
                      via: {msg.toolsUsed.join(', ')}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-500">
                  <IconLoader size={14} className="animate-spin" />
                  Consultando datos…
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="flex gap-2 border-t border-gray-100 p-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu pregunta…"
              disabled={loading}
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-40"
            >
              →
            </button>
          </form>
        </div>
      )}
    </>
  );
}
