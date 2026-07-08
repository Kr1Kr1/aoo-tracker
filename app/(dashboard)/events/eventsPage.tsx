"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Flag, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventsTable } from "./eventsTable";
import { MdjTable } from "./mdjTable";

const PER_PAGE = 100;

export default function EventsPage() {
  const [events, setEvents] = useState([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [eventsOffset, setEventsOffset] = useState(0);
  const [eventsLoading, setEventsLoading] = useState(true);

  const [mdjEntries, setMdjEntries] = useState([]);
  const [totalMdj, setTotalMdj] = useState(0);
  const [mdjOffset, setMdjOffset] = useState(0);
  const [mdjLoading, setMdjLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      setEventsLoading(true);
      try {
        const res = await fetch(`/api/events?offset=${eventsOffset}&limit=${PER_PAGE}`);
        if (res.ok) {
          const data = await res.json();
          setEvents(data.events || []);
          setTotalEvents(data.total || 0);
        } else {
          console.error("Failed to fetch events:", await res.text());
        }
      } catch (err) {
        console.error("Error fetching events:", err);
      } finally {
        setEventsLoading(false);
      }
    };
    run();
  }, [eventsOffset]);

  useEffect(() => {
    const run = async () => {
      setMdjLoading(true);
      try {
        const res = await fetch(`/api/mdj?offset=${mdjOffset}&limit=${PER_PAGE}`);
        if (res.ok) {
          const data = await res.json();
          setMdjEntries(data.entries || []);
          setTotalMdj(data.total || 0);
        } else {
          console.error("Failed to fetch MDJ:", await res.text());
        }
      } catch (err) {
        console.error("Error fetching MDJ:", err);
      } finally {
        setMdjLoading(false);
      }
    };
    run();
  }, [mdjOffset]);

  return (
    <Tabs defaultValue="all">
      <div className="flex items-center">
        <TabsList>
          <TabsTrigger value="all">All Events</TabsTrigger>
          <TabsTrigger value="manual">Manual Events</TabsTrigger>
          <TabsTrigger value="system">System Events</TabsTrigger>
          <TabsTrigger value="mdj">MDJ</TabsTrigger>
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
        {eventsLoading ? (
          <p>Loading events...</p>
        ) : events.length > 0 ? (
          <EventsTable
            events={events}
            totalEvents={totalEvents}
            offset={eventsOffset}
            onNextPage={() => {
              if (eventsOffset + PER_PAGE < totalEvents) setEventsOffset(eventsOffset + PER_PAGE);
            }}
            onPrevPage={() => {
              if (eventsOffset > 0) setEventsOffset(eventsOffset - PER_PAGE);
            }}
          />
        ) : (
          <p>No events available.</p>
        )}
      </TabsContent>
      <TabsContent value="mdj">
        <MdjTable
          entries={mdjEntries}
          total={totalMdj}
          offset={mdjOffset}
          loading={mdjLoading}
          onNextPage={() => {
            if (mdjOffset + PER_PAGE < totalMdj) setMdjOffset(mdjOffset + PER_PAGE);
          }}
          onPrevPage={() => {
            if (mdjOffset > 0) setMdjOffset(mdjOffset - PER_PAGE);
          }}
        />
      </TabsContent>
    </Tabs>
  );
}
