"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { PencilIcon } from "@/components/icons";
import { getFactionColor } from "@/lib/factionColors";

interface PageParams {
  targetId: string;
}

interface Faction {
  name: string;
}

interface Character {
  targetId: string;
  name: string;
  role?: string;
  rank?: string;
  description?: string;
  faction?: Faction;
}

interface Attributes {
  cc?: number;
  ct?: number;
  f?: number;
  e?: number;
  agi?: number;
  fm?: number;
  m?: number;
  pv?: number;
  pm?: number;
  mvt?: number;
  a?: number;
  xp?: number;
  [key: string]: number | undefined;  // Index signature for string keys
}

interface MdjHistoryEntry {
  id: string;
  createdAt: string;
  mdj: string;
}

interface StoryHistory {
  modifiedAt: string;
  story?: string;
}

const CharacterDetailsPage = ({ params }: { params: Promise<PageParams> }) => {
  const router = useRouter();
  const { targetId } = use(params);
  const [character, setCharacter] = useState<Character | null>(null);
  const [mdjHistory, setMdjHistory] = useState<MdjHistoryEntry[]>([]);
  const [storyHistory, setStoryHistory] = useState<StoryHistory | null>(null);
  const [attributes, setAttributes] = useState<Attributes | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedAttributes, setEditedAttributes] = useState<Attributes | null>(null);

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

    // Fetch attributes
    fetch(`/api/characters/${targetId}/attributes`)
      .then((res) => res.json())
      .then((data) => setAttributes(data.attributes))
      .catch((err) => console.error("Error fetching attributes:", err));
  }, [targetId]);

  const handleEditClick = () => {
    setEditedAttributes(attributes || {});
    setIsEditing(true);
  };

  const handleSave = async () => {
    try {
      const response = await fetch(`/api/characters/${targetId}/attributes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editedAttributes),
      });

      if (!response.ok) {
        throw new Error('Failed to update attributes');
      }

      const updatedAttributes = await response.json();
      setAttributes(updatedAttributes);
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating attributes:', error);
      // You might want to show an error message to the user here
    }
  };

  const handleInputChange = (attribute: string, value: string) => {
    setEditedAttributes(prev => ({
      ...(prev || {}),
      [attribute.toLowerCase()]: value === '' ? null : parseInt(value, 10) || 0
    }));
  };

  // Group attributes to show combat relationships
  const attributeGroups = attributes ? {
    "Corps à Corps (CC)": {
      "Attaque": {
        "CC": { value: attributes.cc, desc: "Chance de toucher" },
        "F": { value: attributes.f, desc: "Dégâts infligés" },
      },
      "Défense": {
        "CC/AGI": { 
          value: Math.max(attributes.cc || 0, attributes.agi || 0), 
          desc: "Chance d'esquiver (max(CC, AGI))" 
        },
        "E": { value: attributes.e, desc: "Capacité à encaisser" },
      }
    },
    "Combat à Distance (CT)": {
      "Attaque": {
        "CT": { value: attributes.ct, desc: "Chance de toucher" },
        "F": { value: attributes.f, desc: "Dégâts (dégressif avec la distance)" },
      },
      "Défense": {
        "Esquive": { 
          value: Math.max(
            (3/4 * (attributes.cc || 0) + 1/4 * (attributes.agi || 0)),
            (1/4 * (attributes.cc || 0) + 3/4 * (attributes.agi || 0))
          ).toFixed(1), 
          desc: "Chance d'esquiver (max(3/4CC+1/4AGI, 1/4CC+3/4AGI))" 
        },
        "E": { value: attributes.e, desc: "Capacité à encaisser" },
      }
    },
    "Combat Magique": {
      "Attaque": {
        "FM": { value: attributes.fm, desc: "Chance de toucher" },
        "M": { value: attributes.m, desc: "Dégâts magiques" },
      },
      "Défense": {
        "FM": { value: attributes.fm, desc: "Chance d'esquiver" },
        "M": { value: attributes.m, desc: "Capacité à résister" },
      }
    },
    "Attributs de Base": {
      "AGI": { value: attributes.agi, desc: "Agilité" },
      "PV": { value: attributes.pv, desc: "Points de Vie" },
      "PM": { value: attributes.pm, desc: "Points de Magie" },
      "MVT": { value: attributes.mvt, desc: "Mouvement" },
      "A": { value: attributes.a, desc: "Nombre d'Attaques" },
      "XP": { value: attributes.xp, desc: "Points d'Expérience" },
    }
  } : null;

  const renderStatValue = (name: string, stat: { value: number | undefined }, category?: string) => {
    if (!isEditing) {
      return <span className="font-medium">{stat.value || 0}</span>;
    }

    // Don't show input for calculated values
    if (name === "CC/AGI" || name === "Esquive") {
      return <span className="font-medium">{stat.value || 0}</span>;
    }

    const attrName = name.toLowerCase();
    // Since we know editedAttributes is set in handleEditClick before isEditing becomes true
    return (
      <Input
        type="number"
        value={(editedAttributes as Attributes)[attrName] || 0}
        onChange={(e) => handleInputChange(attrName, e.target.value)}
        className="w-16 h-7 text-right"
      />
    );
  };

  if (!character) {
    return <div className="flex-1 space-y-4 p-8 pt-6">Loading character details...</div>;
  }

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Character Details</h2>
        <button
          className="text-sm text-muted-foreground hover:text-primary"
          onClick={() => router.back()}
        >
          &larr; Back to Characters
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Left Column: Character Details - spans 3 columns */}
        <Card className="relative lg:col-span-3">
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
          <CardContent className="space-y-2">
            <div className="grid gap-2">
              <div className="grid grid-cols-3 items-center gap-4">
                <p className="font-medium">Target ID:</p>
                <p className="col-span-2">{character.targetId}</p>
              </div>
              <div className="grid grid-cols-3 items-center gap-4">
                <p className="font-medium">Rank:</p>
                <p className="col-span-2">{character.rank || "Unknown Rank"}</p>
              </div>
              <div className="grid grid-cols-3 items-center gap-4">
                <p className="font-medium">Description:</p>
                <p className="col-span-2">{character.description || "No description available"}</p>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            {storyHistory ? (
              <div className="space-y-2 w-full">
                <p className="font-medium">Last Story Modified: {new Date(storyHistory.modifiedAt).toLocaleDateString()}</p>
                <p className="text-sm text-muted-foreground">{storyHistory.story || "No story available."}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No story history available for this character.</p>
            )}
          </CardFooter>
        </Card>

        {/* Middle Column: Character Attributes - spans 2 columns */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle>Combat Stats</CardTitle>
              <CardDescription>Statistiques de combat détaillées</CardDescription>
            </div>
            {parseInt(targetId) > 0 && ( // Only show edit button for positive IDs
              <Dialog>
                <DialogTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="h-8"
                  >
                    <PencilIcon className="h-4 w-4 mr-1" />
                    Edit Stats
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[600px]">
                  <DialogHeader>
                    <DialogTitle>Edit Combat Stats</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-6 py-4">
                    {attributeGroups && Object.entries(attributeGroups).map(([group, categories]) => (
                      <div key={group} className="space-y-3">
                        <h3 className="font-semibold text-base border-b pb-1">{group}</h3>
                        {group !== "Attributs de Base" ? (
                          <div className="grid grid-cols-2 gap-4">
                            {Object.entries(categories).map(([category, stats]) => (
                              <div key={category} className="space-y-2">
                                <h4 className="text-sm font-medium text-muted-foreground">{category}</h4>
                                <div className="space-y-1">
                                  {Object.entries(stats).map(([name, stat]) => (
                                    <div 
                                      key={name}
                                      className="flex justify-between items-center p-2 bg-muted/50 rounded"
                                      title={stat.desc}
                                    >
                                      <span className="text-sm">{name}</span>
                                      {renderStatValue(name, stat, category)}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            {Object.entries(categories).map(([name, stat]) => (
                              <div 
                                key={name}
                                className="flex justify-between items-center p-2 bg-muted/50 rounded"
                                title={stat.desc}
                              >
                                <span className="text-sm">{name}</span>
                                {renderStatValue(name, stat)}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsEditing(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSave}>
                      Save Changes
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </CardHeader>
          <CardContent>
            {attributeGroups ? (
              <div className="space-y-6">
                {Object.entries(attributeGroups).map(([group, categories]) => (
                  <div key={group} className="space-y-3">
                    <h3 className="font-semibold text-base border-b pb-1">{group}</h3>
                    {group !== "Attributs de Base" ? (
                      <div className="grid grid-cols-2 gap-4">
                        {Object.entries(categories).map(([category, stats]) => (
                          <div key={category} className="space-y-2">
                            <h4 className="text-sm font-medium text-muted-foreground">{category}</h4>
                            <div className="space-y-1">
                              {Object.entries(stats).map(([name, stat]) => (
                                <div 
                                  key={name}
                                  className="flex justify-between items-center p-2 bg-muted/50 rounded hover:bg-muted"
                                  title={stat.desc}
                                >
                                  <span className="text-sm">{name}</span>
                                  <span className="font-medium">{stat.value || 0}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(categories).map(([name, stat]) => (
                          <div 
                            key={name}
                            className="flex justify-between items-center p-2 bg-muted/50 rounded hover:bg-muted"
                            title={stat.desc}
                          >
                            <span className="text-sm">{name}</span>
                            <span className="font-medium">{stat.value || 0}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Loading attributes...</p>
            )}
          </CardContent>
        </Card>

        {/* Right Column: MDJ History - spans 2 columns */}
        <Card className="lg:col-span-2 flex flex-col h-full">
          <CardHeader>
            <CardTitle>MDJ History</CardTitle>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="relative h-[calc(100vh-300px)] min-h-[400px] max-h-[600px] overflow-y-auto pr-4 
                          hover:pr-2 transition-all duration-200 rounded-md">
              <div className="space-y-6">
                {mdjHistory.length > 0 ? (
                  <ol className="relative border-l border-muted space-y-6">
                    {mdjHistory.map((entry, index) => (
                      <li key={entry.id} className="ml-6">
                        {/* Dot */}
                        <span
                          className={`absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full ${
                            entry.mdj.toLowerCase().includes('cut')
                              ? "bg-red-200 text-red-800"
                              : index === 0
                              ? getFactionColor(character.faction?.name)
                              : "bg-muted border"
                          }`}
                        >
                          <span className={`w-3 h-3 ${index === 0 || entry.mdj.toLowerCase().includes('cut') ? "bg-background" : ""} rounded-full`}></span>
                        </span>

                        {/* Content */}
                        <div className="flex flex-col gap-1">
                          <time className="text-sm text-muted-foreground">
                            {new Date(entry.createdAt).toLocaleDateString()}
                          </time>
                          <p className="text-sm">
                            {entry.mdj}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground">No MDJ history available for this character.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CharacterDetailsPage;
