"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";

// Function to determine faction color
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

const CharacterDetailsPage = ({ params }) => {
  const router = useRouter();
  const { targetId } = params;
  const [character, setCharacter] = useState(null);
  const [mdjHistory, setMdjHistory] = useState([]);
  const [storyHistory, setStoryHistory] = useState(null);

  useEffect(() => {
    // Fetch character details
    fetch(`/api/characters/${targetId}`)
      .then((res) => res.json())
      .then((data) => setCharacter(data))
      .catch((err) => console.error("Error fetching character details:", err));

    // Fetch MDJ history
    fetch(`/api/characters/${targetId}/mdj`)
      .then((res) => res.json())
      .then((data) => setMdjHistory(data))
      .catch((err) => console.error("Error fetching MDJ history:", err));

    // Fetch story history
    fetch(`/api/characters/${targetId}/history`)
      .then((res) => res.json())
      .then((data) => setStoryHistory(data[0]))
      .catch((err) => console.error("Error fetching story history:", err));
  }, [targetId]);

  if (!character) {
    return <p>Loading character details...</p>;
  }

  return (
    <div className="container mx-auto p-8">
      <button
        className="mb-4 text-blue-500 hover:underline"
        onClick={() => router.back()}
      >
        &larr; Back to Characters
      </button>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Left Column: Character Details */}
        <Card className="relative">
          {/* Faction Badge */}
          <div
            className={`absolute top-4 right-4 inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${getFactionColor(
              character.faction?.name
            )}`}
            style={{ width: "fit-content" }}
          >
            <span className="w-2 h-2 rounded-full bg-current"></span>
            {character.faction?.name || "Unknown Faction"}
          </div>

          <CardHeader>
            <CardTitle>{character.name}</CardTitle>
            <CardDescription>
              Role: {character.role || "Unknown Role"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p>
              <strong>Target ID:</strong> {character.targetId}
            </p>
            <p>
              <strong>Rank:</strong> {character.rank || "Unknown Rank"}
            </p>
            <p>
              <strong>Description:</strong>{" "}
              {character.description || "No description available"}
            </p>
          </CardContent>
          <CardFooter>
            {storyHistory ? (
              <div>
                <p>
                  <strong>Last Story Modified:</strong>{" "}
                  {new Date(storyHistory.modifiedAt).toLocaleDateString()}
                </p>
                <p>{storyHistory.story || "No story available."}</p>
              </div>
            ) : (
              <p>No story history available for this character.</p>
            )}
          </CardFooter>
        </Card>

        {/* Right Column: MDJ History */}
        <Card>
          <CardHeader>
            <CardTitle>MDJ History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              {mdjHistory.length > 0 ? (
                <ol className="relative border-l border-gray-200">
                  {mdjHistory.map((entry, index) => (
                    <li key={entry.id} className="mb-10 ml-6">
                      {/* Dot */}
                      <span
                        className={`absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full ${
                          index === 0
                            ? "bg-blue-600"
                            : "bg-gray-200 border border-gray-300"
                        }`}
                      >
                        {index === 0 && (
                          <span className="w-3 h-3 bg-white rounded-full"></span>
                        )}
                      </span>

                      {/* Content */}
                      <div className="flex flex-col gap-1">
                        <time className="mb-1 text-sm font-normal text-gray-400">
                          {new Date(entry.createdAt).toLocaleDateString()}
                        </time>
                        <p className="text-base font-medium text-gray-800">
                          {entry.mdj}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>No MDJ history available for this character.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CharacterDetailsPage;
