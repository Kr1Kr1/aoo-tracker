"use client";

import Link from "next/link";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface MdjEntry {
  id: number;
  mdj: string;
  createdAt: string;
  character: {
    id: number;
    targetId: number;
    name: string;
    faction: { name: string } | null;
  };
}

export function MdjTable({
  entries,
  total,
  offset,
  onNextPage,
  onPrevPage,
  loading,
}: {
  entries: MdjEntry[];
  total: number;
  offset: number;
  onNextPage: () => void;
  onPrevPage: () => void;
  loading: boolean;
}) {
  const limit = 100;

  if (loading) return <p>Chargement…</p>;
  if (entries.length === 0) return <p>Aucun MDJ enregistré.</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mots du jour</CardTitle>
        <CardDescription>
          Historique des MDJ collectés sur le plateau et dans les logs, du plus récent au plus ancien.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Personnage</TableHead>
              <TableHead>Faction</TableHead>
              <TableHead>MDJ</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <Link
                    href={`/characters/${e.character.targetId}`}
                    className="hover:underline"
                  >
                    {e.character.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {e.character.faction?.name || "—"}
                </TableCell>
                <TableCell className="whitespace-pre-wrap">{e.mdj}</TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {new Date(e.createdAt).toLocaleString("fr-FR")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <CardFooter className="flex justify-between">
        <span className="text-sm text-muted-foreground">
          {offset + 1}–{Math.min(offset + entries.length, total)} sur {total}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onPrevPage}
            disabled={offset === 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onNextPage}
            disabled={offset + limit >= total}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
