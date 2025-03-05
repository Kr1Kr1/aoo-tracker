"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Flag, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventsTable } from "./eventsTable";

export default function EventsPage() {
  const [events, setEvents] = useState([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  const eventsPerPage = 100; // Adjust the number of events per page as needed

  useEffect(() => {
    const fetchEvents = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/events?offset=${offset}&limit=${eventsPerPage}`);
        if (response.ok) {
          const data = await response.json();
          setEvents(data.events || []);
          setTotalEvents(data.total || 0);
        } else {
          console.error("Failed to fetch events:", await response.text());
        }
      } catch (error) {
        console.error("Error fetching events:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, [offset]);

  const handleTabChange = (value: string) => {
    // Logic to filter events based on the tab (all, manual, system)
    console.log("Tab changed to:", value);
    // You can add specific filters here
  };

  const handleNextPage = () => {
    if (offset + eventsPerPage < totalEvents) {
      setOffset(offset + eventsPerPage);
    }
  };

  const handlePrevPage = () => {
    if (offset > 0) {
      setOffset(offset - eventsPerPage);
    }
  };

  return (
    <Tabs defaultValue="all" onValueChange={handleTabChange}>
      <div className="flex items-center">
        <TabsList>
          <TabsTrigger value="all">All Events</TabsTrigger>
          <TabsTrigger value="manual">Manual Events</TabsTrigger>
          <TabsTrigger value="system">System Events</TabsTrigger>
        </TabsList>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 gap-1">
            <Flag className="h-3.5 w-3.5" />
            <span className="sr-only sm:not-sr-only">Export</span>
          </Button>
          <Button size="sm" className="h-8 gap-1">
            <PlusCircle className="h-3.5 w-3.5" />
            <span className="sr-only sm:not-sr-only">Add Event</span>
          </Button>
        </div>
      </div>
      <TabsContent value="all">
        {loading ? (
          <p>Loading events...</p>
        ) : events.length > 0 ? (
          <EventsTable
            events={events}
            totalEvents={totalEvents}
            offset={offset}
            onNextPage={handleNextPage}
            onPrevPage={handlePrevPage}
          />
        ) : (
          <p>No events available.</p>
        )}
      </TabsContent>
    </Tabs>
  );
}
