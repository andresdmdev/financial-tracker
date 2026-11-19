import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface Props {
  source: string;
  className?: string;
}

const COMPONENTS: Components = {
  table: ({ node: _node, ...props }) => (
    <div className="not-prose my-4 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  thead: ({ node: _node, ...props }) => <thead className="bg-muted/60" {...props} />,
  th: ({ node: _node, ...props }) => (
    <th
      className="border-b border-border px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground"
      {...props}
    />
  ),
  td: ({ node: _node, ...props }) => (
    <td className="border-b border-border px-3 py-2 align-top last:border-b-0 [tr:last-child_&]:border-b-0" {...props} />
  ),
  a: ({ node: _node, ...props }) => <a target="_blank" rel="noopener noreferrer" {...props} />,
};

/**
 * Renders a markdown document with GitHub-flavoured extensions (tables, task
 * lists, strikethrough). `react-markdown` builds React elements and never
 * injects raw HTML, so a document is safe to render whoever wrote it.
 *
 * Meant to be used without a `client:*` directive: Astro renders it to static
 * HTML on the server and ships no JavaScript for it. Tables sit in their own
 * horizontally scrolling box so a wide budget never widens the page on a phone.
 */
export default function MarkdownView({ source, className }: Props): React.ReactElement {
  return (
    <div
      className={cn(
        'prose prose-sm max-w-none text-foreground prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-foreground prose-h1:text-xl prose-h2:mt-8 prose-h2:text-lg prose-h3:text-base prose-p:leading-relaxed prose-a:text-primary prose-strong:text-foreground prose-li:my-0.5',
        className,
      )}
    >
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {source}
      </Markdown>
    </div>
  );
}
