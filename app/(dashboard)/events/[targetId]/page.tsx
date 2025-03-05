"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function EditEventPage({ params }) {
  const { id } = params; // Access the dynamic route parameter
  const [eventData, setEventData] = useState({
    event: "",
    details: "",
    fromCol: "",
    withWhom: "",
    date: "",
    territory: "",
    source: "",
  });

  const router = useRouter();

  useEffect(() => {
    // Fetch the event data by ID
    fetch(`/api/events/${id}`)
      .then((res) => res.json())
      .then((data) => setEventData(data))
      .catch((err) => console.error("Error fetching event:", err));
  }, [id]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      const response = await fetch(`/api/events/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventData),
      });

      if (response.ok) {
        alert("Event updated successfully!");
        router.push("/events"); // Redirect to the events page
      } else {
        alert("Failed to update the event.");
      }
    } catch (err) {
      console.error("Error updating event:", err);
    }
  };

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Edit Event</h1>
      <form
        onSubmit={handleSubmit}
        className="mb-8 grid grid-cols-1 md:grid-cols-6 gap-4"
      >
        <input
          type="text"
          placeholder="Event"
          value={eventData.event}
          onChange={(e) =>
            setEventData({ ...eventData, event: e.target.value })
          }
          className="border px-4 py-2"
          required
        />
        <input
          type="text"
          placeholder="Details"
          value={eventData.details}
          onChange={(e) =>
            setEventData({ ...eventData, details: e.target.value })
          }
          className="border px-4 py-2"
        />
        <input
          type="text"
          placeholder="From"
          value={eventData.fromCol}
          onChange={(e) =>
            setEventData({ ...eventData, fromCol: e.target.value })
          }
          className="border px-4 py-2"
          required
        />
        <input
          type="text"
          placeholder="With Whom"
          value={eventData.withWhom}
          onChange={(e) =>
            setEventData({ ...eventData, withWhom: e.target.value })
          }
          className="border px-4 py-2"
        />
        <input
          type="datetime-local"
          value={eventData.date}
          onChange={(e) =>
            setEventData({ ...eventData, date: e.target.value })
          }
          className="border px-4 py-2"
          required
        />
        <input
          type="text"
          placeholder="Territory"
          value={eventData.territory}
          onChange={(e) =>
            setEventData({ ...eventData, territory: e.target.value })
          }
          className="border px-4 py-2"
          required
        />
        <button
          type="submit"
          className="bg-blue-500 text-white px-4 py-2 rounded col-span-1 md:col-span-6"
        >
          Save Changes
        </button>
      </form>
    </div>
  );
}
