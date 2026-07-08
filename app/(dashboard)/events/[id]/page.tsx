"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";

interface EventData {
  event: string;
  details: string;
  fromCol: string;
  withWhom: string;
  date: string;
  territory: string;
  source: string;
}

const EMPTY_EVENT: EventData = {
  event: "",
  details: "",
  fromCol: "",
  withWhom: "",
  date: "",
  territory: "",
  source: "",
};

export default function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [eventData, setEventData] = useState<EventData>(EMPTY_EVENT);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/events/${id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setEventData({ ...EMPTY_EVENT, ...data }))
      .catch((err) => setError(`Failed to load event: ${err.message}`));
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventData),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.push("/events");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const update = (field: keyof EventData, value: string) =>
    setEventData((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Edit Event</h1>
      {error && (
        <div className="mb-4 p-3 text-sm border rounded-md border-red-500 bg-red-50 text-red-600">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="mb-8 grid grid-cols-1 md:grid-cols-6 gap-4">
        <input
          type="text"
          placeholder="Event"
          value={eventData.event}
          onChange={(e) => update("event", e.target.value)}
          className="border px-4 py-2"
          required
        />
        <input
          type="text"
          placeholder="Details"
          value={eventData.details}
          onChange={(e) => update("details", e.target.value)}
          className="border px-4 py-2"
        />
        <input
          type="text"
          placeholder="From"
          value={eventData.fromCol}
          onChange={(e) => update("fromCol", e.target.value)}
          className="border px-4 py-2"
          required
        />
        <input
          type="text"
          placeholder="With Whom"
          value={eventData.withWhom}
          onChange={(e) => update("withWhom", e.target.value)}
          className="border px-4 py-2"
        />
        <input
          type="datetime-local"
          value={eventData.date}
          onChange={(e) => update("date", e.target.value)}
          className="border px-4 py-2"
          required
        />
        <input
          type="text"
          placeholder="Territory"
          value={eventData.territory}
          onChange={(e) => update("territory", e.target.value)}
          className="border px-4 py-2"
          required
        />
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-500 text-white px-4 py-2 rounded col-span-1 md:col-span-6 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </form>
    </div>
  );
}
