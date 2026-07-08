import Link from "next/link";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getFactionColor } from "@/lib/factionColors";

interface EventRow {
  id: number;
  event: string;
  details: string | null;
  fromCol: string;
  withWhom: string | null;
  territory: string;
  source: string;
  calculatedDate: string | null;
  fromCharacterFaction: { name: string } | null;
}

export function EventsTable({
  events,
  totalEvents,
  offset,
  onNextPage,
  onPrevPage,
}: {
  events: EventRow[];
  totalEvents: number;
  offset: number;
  onNextPage: () => void;
  onPrevPage: () => void;
}) {
  const eventsPerPage = 5;

  const extractCharacterInfo = (fromCol: string) => {
    const match = fromCol.match(/\(mat\.(\d+)\)/); // Match "Name (mat.<ID>)"
    if (!match) return { name: fromCol, targetId: null };
    const [, targetId] = match;
    return { targetId: parseInt(targetId, 10) };
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Events</CardTitle>
        <CardDescription>Manage and view all your events.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>From</TableHead>
              <TableHead>With Whom</TableHead>
              <TableHead>Territory</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => {
              const { targetId } = extractCharacterInfo(event.fromCol);

              return (
                <TableRow key={event.id}>
                  <TableCell>{event.event}</TableCell>
                  <TableCell>{event.details || "N/A"}</TableCell>
                  <TableCell>
                    {targetId ? (
                      <Link href={`/characters/${targetId}`}>
                        <span
                          className={`inline-flex items-center gap-2 px-2 py-1 rounded-full text-sm font-medium ${getFactionColor(
                            event.fromCharacterFaction?.name
                          )}`}
                          style={{ width: "fit-content" }}
                        >
                          <span className="w-2 h-2 rounded-full bg-current"></span>
                          {event.fromCol}
                        </span>
                      </Link>
                    ) : (
                      <span>{event.fromCol}</span>
                    )}
                  </TableCell>
                  <TableCell>{event.withWhom || "N/A"}</TableCell>
                  <TableCell>{event.territory}</TableCell>
                  <TableCell>{event.source}</TableCell>
                  <TableCell>
                    {event.calculatedDate
                      ? new Date(event.calculatedDate).toLocaleString()
                      : "N/A"}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-label="Actions" variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem>Edit</DropdownMenuItem>
                        <DropdownMenuItem className="text-red-600">Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
      <CardFooter>
        <div className="flex justify-between items-center w-full">
          <div className="text-xs text-muted-foreground">
            Showing {Math.max(0, offset + 1)} -{" "}
            {Math.min(offset + eventsPerPage, totalEvents)} of {totalEvents}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={offset === 0} onClick={onPrevPage}>
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={offset + eventsPerPage >= totalEvents}
              onClick={onNextPage}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardFooter>
    </Card>
  );
}
