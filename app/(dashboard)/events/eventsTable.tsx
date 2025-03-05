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

export function EventsTable({
  events,
  totalEvents,
  offset,
  onNextPage,
  onPrevPage,
}: {
  events: any[];
  totalEvents: number;
  offset: number;
  onNextPage: () => void;
  onPrevPage: () => void;
}) {
  const eventsPerPage = 5;

  const getFactionColor = (faction) => {
    switch (faction?.toLowerCase()) {
      case "le royaume des cimes":
        return "bg-amber-200 text-amber-800";
      case "saruta & frères":
        return "bg-yellow-200 text-yellow-800";
      case "eryn dolen":
        return "bg-green-200 text-green-800";
      case "dieux":
        return "bg-purple-200 text-purple-800";
      case "la forge sacrée":
        return "bg-red-200 text-red-800";
      case "praetorium":
        return "bg-orange-200 text-orange-800";
      case "le tertre sauvage":
        return "bg-emerald-200 text-emerald-800";
      case "redoraan":
        return "bg-rose-200 text-rose-800";
      case "apatrides":
        return "bg-gray-300 text-gray-800";
      case "bahamut":
        return "bg-indigo-200 text-indigo-800";
      default:
        return "bg-gray-200 text-gray-800";
    }
  };

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
