"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StarIcon } from "@/components/icons";
import { getFactionColor } from "@/lib/factionColors";

const baseURL = "https://age-of-olympia.net/infos.php?targetId=";

// Minimal shape used in this component
type Character = {
  id: number;
  targetId: number | string;
  name: string;
  faction?: { name?: string } | null;
  role?: string | null;
  rank?: string | null;
  attributes?: { xp?: number } | null;
  avatarUrl?: string | null;
};

export default function CharactersPage() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [filter, setFilter] = useState("");
  const [factionFilter, setFactionFilter] = useState("All");
  const [characterType, setCharacterType] = useState("All");
  const router = useRouter();

  useEffect(() => {
    fetch("/api/characters")
      .then(async (res) => {
        const json = await res.json().catch(() => [] as Character[]);
        return Array.isArray(json) ? (json as Character[]) : ([] as Character[]);
      })
      .then((data) => setCharacters(data))
      .catch((err) => console.error("Error fetching characters:", err));
  }, []);

  const filteredCharacters = characters.filter((character: Character) => {
    const matchesName = character.name.toLowerCase().includes(filter.toLowerCase());
    const matchesFaction =
      factionFilter === "All" || character.faction?.name === factionFilter;
    const matchesType = characterType === "All" 
      ? true 
      : characterType === "PJ" 
        ? Number(character.targetId) > 0 
        : Number(character.targetId) < 0;
    return matchesName && matchesFaction && matchesType;
  });

  const handleViewDetails = (targetId: number | string) => {
    router.push(`/characters/${targetId}`);
  };

  return (
    <div className="flex flex-col flex-1 gap-4 p-4 md:gap-8 md:p-6">
      <div className="flex items-center">
        <h1 className="font-semibold text-lg md:text-2xl">Characters</h1>
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
        
        <Select value={factionFilter} onValueChange={setFactionFilter}>
          <SelectTrigger className="sm:max-w-[250px]">
            <SelectValue placeholder="Select faction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Factions</SelectItem>
            <SelectItem value="Le Royaume des Cimes">Le Royaume des Cimes</SelectItem>
            <SelectItem value="Saruta & Frères">Saruta & Frères</SelectItem>
            <SelectItem value="Eryn Dolen">Eryn Dolen</SelectItem>
            <SelectItem value="Dieux">Dieux</SelectItem>
            <SelectItem value="La Forge Sacrée">La Forge Sacrée</SelectItem>
            <SelectItem value="Praetorium">Praetorium</SelectItem>
            <SelectItem value="Le Tertre Sauvage">Le Tertre Sauvage</SelectItem>
            <SelectItem value="Redoraan">Redoraan</SelectItem>
            <SelectItem value="Apatrides">Apatrides</SelectItem>
            <SelectItem value="Bahamut">Bahamut</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
        {filteredCharacters.map((character) => (
          <Card key={character.targetId} className="relative">
            <CardHeader className="space-y-0 pb-2">
              <CardTitle className="text-sm font-medium flex items-center justify-between">
                {character.name}
                <div className="flex items-center space-x-1">
                  <a
                    href={`${baseURL}${character.targetId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-600"
                    title="View Character Details"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M14 3h7m0 0v7m0-7L10 14m-4 0H3m0 0v7m0-7l7-7"
                      />
                    </svg>
                  </a>
                  <button
                    onClick={() => handleViewDetails(character.targetId)}
                    className="text-gray-500 hover:text-gray-700"
                    title="View More Details"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-4 h-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                    </svg>
                  </button>
                </div>
              </CardTitle>
              <div
                className={`mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getFactionColor(
                  character.faction?.name
                )}`}
                style={{ width: "fit-content" }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                {character.faction?.name || "Unknown"}
              </div>
            </CardHeader>
            <CardContent className="text-xs space-y-1.5">
              <p>ID: {character.targetId}</p>
              <p>Role: {character.role || "Unknown Role"}</p>
              <p>Rank: {character.rank || "Unknown Rank"}</p>
              <div className="flex items-center gap-1 text-amber-500">
                <StarIcon className="w-3.5 h-3.5" />
                <span>{character.attributes?.xp?.toLocaleString() || "0"} XP</span>
              </div>
            </CardContent>
            {character.avatarUrl && (
              <img
                src={character.avatarUrl}
                alt={`${character.name}'s avatar`}
                className="absolute top-0 right-0 w-12 h-12 rounded-full shadow-lg m-3"
              />
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
