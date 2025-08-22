"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function RankingsPage() {
  const [characters, setCharacters] = useState([]);
  const [filter, setFilter] = useState("");
  const [characterType, setCharacterType] = useState("All");

  useEffect(() => {
    // Fetch characters with their latest XP
    fetch("/api/characters")
      .then((res) => res.json())
      .then((data) => {
        // Sort characters by XP
        const sortedCharacters = data.sort((a, b) => {
          const xpA = a.attributes?.xp || 0;
          const xpB = b.attributes?.xp || 0;
          return xpB - xpA;
        });
        setCharacters(sortedCharacters);
      })
      .catch((err) => console.error("Error fetching characters:", err));
  }, []);

  const filteredCharacters = characters.filter((character) => {
    const matchesName = character.name.toLowerCase().includes(filter.toLowerCase());
    const matchesType = characterType === "All" 
      ? true 
      : characterType === "PJ" 
        ? Number(character.targetId) > 0 
        : Number(character.targetId) < 0;
    return matchesName && matchesType;
  });

  return (
    <div className="flex flex-col flex-1 gap-4 p-4 md:gap-8 md:p-6">
      <div className="flex items-center">
        <h1 className="font-semibold text-lg md:text-2xl">Rankings</h1>
      </div>
      
      <div className="flex flex-col sm:flex-row gap-4 items-center">
        <Tabs
          defaultValue="All"
          value={characterType}
          onValueChange={setCharacterType}
          className="w-[300px]"
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="All">All</TabsTrigger>
            <TabsTrigger value="PJ">PJ</TabsTrigger>
            <TabsTrigger value="PNJ">PNJ</TabsTrigger>
          </TabsList>
        </Tabs>

        <Input
          type="text"
          placeholder="Search by name"
          className="sm:max-w-[250px]"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>XP Rankings</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Rank</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>XP</TableHead>
                <TableHead>Last Change</TableHead>
                <TableHead>24h Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCharacters.map((character, index) => {
                const characterLogs = xpHistory.filter(log => log.characterId === character.id);
                const lastChange = characterLogs[0];
                const last24hChanges = characterLogs.filter(log => {
                  const logDate = new Date(log.changedAt);
                  const now = new Date();
                  const diff = now.getTime() - logDate.getTime();
                  return diff <= 24 * 60 * 60 * 1000;
                });
                
                const xpDiff24h = last24hChanges.reduce((acc, log) => {
                  const oldValue = parseInt(log.oldValue || "0", 10);
                  const newValue = parseInt(log.newValue || "0", 10);
                  return acc + (newValue - oldValue);
                }, 0);

                return (
                  <TableRow key={character.id}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell className="font-medium">{character.name}</TableCell>
                    <TableCell>{character.attributes?.xp || 0}</TableCell>
                    <TableCell>
                      {lastChange ? (
                        <span className={lastChange.newValue > lastChange.oldValue ? "text-green-600" : "text-red-600"}>
                          {lastChange.newValue > lastChange.oldValue ? "+" : ""}
                          {parseInt(lastChange.newValue || "0", 10) - parseInt(lastChange.oldValue || "0", 10)}
                        </span>
                      ) : "-"}
                    </TableCell>
                    <TableCell>
                      <span className={xpDiff24h > 0 ? "text-green-600" : xpDiff24h < 0 ? "text-red-600" : ""}>
                        {xpDiff24h > 0 ? "+" : ""}
                        {xpDiff24h}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}