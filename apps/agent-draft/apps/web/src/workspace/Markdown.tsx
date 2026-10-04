import { memo, useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Highlighter = (code: string, lang: string) => Promise<string>;
let highlighter: Promise<Highlighter> | null = null;

/** Loads Shiki lazily on first code block; unknown languages fall back to plain text. */
function getHighlighter(): Promise<Highlighter> {
  highlighter ??= import('shiki/bundle/web').then(({ codeToHtml, bundledLanguages }) => async (code: string, lang: string) => {
    const language = lang in bundledLanguages ? lang : 'text';
    return codeToHtml(code, { lang: language, theme: 'github-dark-dimmed' });
  });
  return highlighter;
}

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void getHighlighter()
      .then((h) => h(code, lang))
      .then((out) => {
        if (alive) setHtml(out);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [code, lang]);
  if (html === null) {
    return (
      <pre className="overflow-x-auto rounded-md bg-zinc-900 p-3 text-[12.5px]">
        <code>{code}</code>
      </pre>
    );
  }
  // Shiki output is generated locally from the code string; it escapes all content.
  return <div className="code-block" dangerouslySetInnerHTML={{ __html: html }} />;
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children }) {
            const match = /language-(\w+)/.exec(className ?? '');
            const content = textOf(children).replace(/\n$/, '');
            if (!match && !content.includes('\n')) return <code>{children}</code>;
            return <CodeBlock code={content} lang={match?.[1] ?? 'text'} />;
          },
          pre: ({ children }) => <>{children}</>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((n: ReactNode) => textOf(n)).join('');
  return '';
}
