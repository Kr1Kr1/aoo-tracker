"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

export default function PrivateForumPage() {
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Fetch topics from the API
    fetch("/api/forums/private")
      .then((res) => res.json())
      .then((data) => {
        setTopics(data.topics);
        setLoading(false);
      })
      .catch((err) => console.error("Error fetching private forum topics:", err));
  }, []);

  const handleViewTopic = (id) => {
    router.push(`/forum/private/${id}`);
  };

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Private Forum Topics</h1>

      {loading ? (
        <p>Loading topics...</p>
      ) : (
        <Table className="border border-gray-400">
          <TableHeader>
            <TableRow>
              <TableHead className="px-4 py-2">Topic</TableHead>
              <TableHead className="px-4 py-2">Author</TableHead>
              <TableHead className="px-4 py-2">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topics.map((topic) => (
              <TableRow key={topic.id}>
                <TableCell className="px-4 py-2">{topic.name}</TableCell>
                <TableCell className="px-4 py-2">{topic.author?.name || "Unknown"}</TableCell>
                <TableCell className="px-4 py-2">
                  <button
                    className="text-blue-500 hover:underline"
                    onClick={() => handleViewTopic(topic.id)}
                  >
                    View Messages
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
