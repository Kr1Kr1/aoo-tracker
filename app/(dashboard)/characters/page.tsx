"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation"; // Next.js router for navigation
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const baseURL = "https://age-of-olympia.net/infos.php?targetId="; // Base URL for character links

export default function CharactersPage() {
  const [characters, setCharacters] = useState([]);
  const [filter, setFilter] = useState(""); // For name search
  const [factionFilter, setFactionFilter] = useState("All"); // For faction filtering
  const router = useRouter();

  useEffect(() => {
    // Fetch characters from the API
    fetch("/api/characters")
      .then((res) => res.json())
      .then((data) => setCharacters(data))
      .catch((err) => console.error("Error fetching characters:", err));
  }, []);

  const getFactionColor = (faction) => {
    switch (faction?.toLowerCase()) {
      case "le royaume des cimes":
        return "bg-amber-200 text-amber-800"; // Amber (close to brown)
      case "saruta & frères":
        return "bg-yellow-200 text-yellow-800"; // Yellow
      case "eryn dolen":
        return "bg-green-200 text-green-800"; // Green
      case "dieux":
        return "bg-purple-200 text-purple-800"; // Purple
      case "la forge sacrée":
        return "bg-red-200 text-red-800"; // Red
      case "praetorium":
        return "bg-orange-200 text-orange-800"; // Orange
      case "le tertre sauvage":
        return "bg-emerald-200 text-emerald-800"; // Emerald (dark green)
      case "redoraan":
        return "bg-rose-200 text-rose-800"; // Rose
      case "apatrides":
        return "bg-gray-300 text-gray-800"; // Gray
      case "bahamut":
        return "bg-indigo-200 text-indigo-800"; // Indigo
      default:
        return "bg-gray-200 text-gray-800"; // Default gray
    }
  };

  const filteredCharacters = characters.filter((character) => {
    const matchesName = character.name.toLowerCase().includes(filter.toLowerCase());
    const matchesFaction =
      factionFilter === "All" || character.faction?.name === factionFilter;
    return matchesName && matchesFaction;
  });

  const handleViewDetails = (targetId) => {
    router.push(`/characters/${targetId}`);
  };

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Characters</h1>

      <div className="flex flex-wrap gap-4 mb-6">
        <input
          type="text"
          placeholder="Search by name"
          className="border rounded px-4 py-2 w-full sm:w-auto"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select
          className="border rounded px-4 py-2 w-full sm:w-auto"
          value={factionFilter}
          onChange={(e) => setFactionFilter(e.target.value)}
        >
          <option value="All">All Factions</option>
          <option value="Le Royaume des Cimes">Le Royaume des Cimes</option>
          <option value="Saruta & Frères">Saruta & Frères</option>
          <option value="Eryn Dolen">Eryn Dolen</option>
          <option value="Dieux">Dieux</option>
          <option value="La Forge Sacrée">La Forge Sacrée</option>
          <option value="Praetorium">Praetorium</option>
          <option value="Le Tertre Sauvage">Le Tertre Sauvage</option>
          <option value="Redoraan">Redoraan</option>
          <option value="Apatrides">Apatrides</option>
          <option value="Bahamut">Bahamut</option>
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {filteredCharacters.map((character) => (
          <Card key={character.targetId} className="relative">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                {character.name}
                <div className="flex items-center space-x-2">
                  <a
                    href={`${baseURL}${character.targetId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-blue-400 hover:text-blue-600"
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
                      className="w-5 h-5"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                    </svg>
                  </button>
                </div>
              </CardTitle>
              <div
                className={`mt-2 inline-flex items-center gap-2 px-2 py-1 rounded-full text-sm font-medium ${getFactionColor(
                  character.faction?.name
                )}`}
                style={{ width: "fit-content" }}
              >
                <span className="w-2 h-2 rounded-full bg-current"></span>
                {character.faction?.name || "Unknown"}
              </div>
            </CardHeader>
            <CardContent>
              <div>
                <p>Target ID: {character.targetId}</p>
                <p>Role: {character.role || "Unknown Role"}</p>
                <p>Rank: {character.rank || "Unknown Rank"}</p>
                <p className="mt-2 text-gray-600 italic">
                  {character.description || "No description available"}
                </p>
              </div>
            </CardContent>
            {character.avatarUrl && (
              <img
                src={character.avatarUrl}
                alt={`${character.name}'s avatar`}
                className="absolute top-0 right-0 w-16 h-16 rounded-full shadow-lg m-4"
              />
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
