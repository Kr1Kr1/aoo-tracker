"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DraftReplies } from "@/components/draft-replies";

export type MissivePost = {
  id: number;
  author: string;
  date: string;
  /** Already sanitized server-side by sanitizeForumHtml. */
  html: string;
  isMine: boolean;
};

// Same page size as the forum engine (see TOPIC_PAGE_SIZE in the extension),
// so a page of the tracker holds the same posts as a page in game.
const POSTS_PER_PAGE = 5;

export function MissiveThread({
  topicId,
  closed,
  posts,
}: {
  topicId: number;
  closed: boolean;
  posts: MissivePost[];
}) {
  const pageCount = Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // Threads open on their last page: that is where the new posts and the reply
  // box are, the way the game drops you at the end of a missive.
  const [page, setPage] = useState(pageCount);

  const paginated = !showAll && pageCount > 1;
  const currentPage = Math.min(page, pageCount);
  const visible = paginated
    ? posts.slice((currentPage - 1) * POSTS_PER_PAGE, currentPage * POSTS_PER_PAGE)
    : posts;
  const onLastPage = !paginated || currentPage === pageCount;

  const count = posts.length;
  const plural = count > 1 ? "s" : "";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="px-2 text-muted-foreground hover:text-foreground"
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) setPage(pageCount);
          }}
        >
          {open ? `▾ Replier` : `▸ Voir les ${count} message${plural}`}
        </Button>
        {open && pageCount > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? "Paginer" : `Tout afficher (${count})`}
          </Button>
        )}
      </div>

      {open && (
        <>
          {paginated && (
            <Pager page={currentPage} pageCount={pageCount} onChange={setPage} className="mt-2" />
          )}

          <div className="mt-3 space-y-3">
            {visible.map((post) => (
              <div
                key={post.id}
                className={`p-3 rounded text-sm ${
                  post.isMine ? "bg-blue-50 ml-8" : "bg-gray-50 mr-8"
                }`}
              >
                <div className="text-xs font-medium mb-1 flex justify-between">
                  <span>{post.author}</span>
                  <span className="text-muted-foreground">{post.date}</span>
                </div>
                <div
                  className="prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: post.html }}
                />
              </div>
            ))}
          </div>

          {paginated && (
            <Pager page={currentPage} pageCount={pageCount} onChange={setPage} className="mt-3" />
          )}

          {/* Reply box after the last post of the thread, never mid-thread. */}
          {!closed && onLastPage && (
            <div className="mt-3 ml-8 border-t pt-3">
              <DraftReplies topicId={topicId} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Pager({
  page,
  pageCount,
  onChange,
  className = "",
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1 text-xs ${className}`}>
      <PagerButton disabled={page === 1} onClick={() => onChange(1)} label="«" title="Premier" />
      <PagerButton
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
        label="‹"
        title="Précédent"
      />
      <span className="px-2 text-muted-foreground">
        page {page}/{pageCount}
      </span>
      <PagerButton
        disabled={page === pageCount}
        onClick={() => onChange(page + 1)}
        label="›"
        title="Suivant"
      />
      <PagerButton
        disabled={page === pageCount}
        onClick={() => onChange(pageCount)}
        label="»"
        title="Dernier"
      />
    </div>
  );
}

function PagerButton({
  disabled,
  onClick,
  label,
  title,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded border px-2 py-0.5 text-muted-foreground enabled:hover:bg-muted disabled:opacity-40"
    >
      {label}
    </button>
  );
}
