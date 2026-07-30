"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { sanitizeForumHtml } from "@/lib/sanitizeForumHtml";
import { formatMessageDate, messageTime, sortMessagesChronologically } from "@/lib/messageDate";

type Message = {
  id: number;
  content: string;
  date: string;
  createdAt: Date | string;
  character: { name: string };
};

type Topic = {
  id: number;
  name: string;
  link: string;
  updatedAt: Date | string;
  author: { name: string };
  messages: Message[];
};

type SortKey = "newest" | "oldest";

// Ordered by the date the message carries in game, not by `createdAt`
// (ingestion time) nor `updatedAt` (bumped by every sync).
function lastActivity(t: Topic): number {
  const last = t.messages[t.messages.length - 1];
  return last ? messageTime(last) : new Date(t.updatedAt).getTime();
}

export function TopicList({ topics }: { topics: Topic[] }) {
  const [sort, setSort] = useState<SortKey>("newest");

  const sorted = useMemo(() => {
    const copy = topics.map((t) => ({ ...t, messages: sortMessagesChronologically(t.messages) }));
    copy.sort((a, b) => {
      const diff = lastActivity(b) - lastActivity(a);
      return sort === "newest" ? diff : -diff;
    });
    return copy;
  }, [topics, sort]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSort(sort === "newest" ? "oldest" : "newest")}
        >
          {sort === "newest" ? "↓ Plus récents d'abord" : "↑ Plus anciens d'abord"}
        </Button>
      </div>
      <div className="space-y-3">
        {sorted.map((topic) => {
          const last = topic.messages[topic.messages.length - 1];
          const count = topic.messages.length;
          return (
            <div key={topic.id} className="rounded border p-3">
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <div className="text-base font-medium">{topic.name}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Par {topic.author.name} · {count} message{count > 1 ? "s" : ""}
                    {last && (
                      <>
                        {" "}
                        · Dernier : {last.character.name} · {formatMessageDate(last)}
                      </>
                    )}
                  </p>
                </div>
              </div>
              {count > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                    Voir les {count} message{count > 1 ? "s" : ""}
                  </summary>
                  <div className="mt-3 space-y-3 max-h-[600px] overflow-y-auto pr-2">
                    {topic.messages.map((m) => (
                      <div key={m.id} className="p-3 rounded bg-gray-50 text-sm">
                        <div className="text-xs font-medium mb-1 flex justify-between">
                          <span>{m.character.name}</span>
                          <span className="text-muted-foreground">{formatMessageDate(m)}</span>
                        </div>
                        <div
                          className="prose prose-sm max-w-none"
                          dangerouslySetInnerHTML={{ __html: sanitizeForumHtml(m.content) }}
                        />
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
