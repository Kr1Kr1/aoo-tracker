"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getFactionColor } from "@/lib/factionColors";

interface RecentCharacter {
  targetId: number;
  name: string;
  faction?: { name: string } | null;
  createdAt: string;
}

export default function DashboardSummary() {
  const [recentData, setRecentData] = useState<RecentCharacter[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/recent?model=characters&days=7`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setRecentData(data))
      .catch((err) => console.error("[dashboard] recent fetch failed:", err))
      .finally(() => setLoading(false));
  }, []);

  const filteredData = recentData.filter((record) => {
    if (filter === "pj") return record.targetId > 0;
    if (filter === "pnj") return record.targetId < 0;
    return true;
  });

  return (
    <div className="flex-1 w-full">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Recent Characters</CardTitle>
            <Tabs value={filter} onValueChange={setFilter} className="w-auto">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="pj">PJ</TabsTrigger>
                <TabsTrigger value="pnj">PNJ</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p>Loading...</p>
          ) : filteredData.length > 0 ? (
            <div className="w-full">
              <ul>
                {filteredData.map((record, index) => (
                  <li key={index} className="flex items-center justify-between p-1 hover:bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${record.targetId > 0 ? 'bg-gray-200 text-gray-800' : 'bg-gray-300 text-gray-700'}`}>
                        {record.targetId > 0 ? 'PJ' : 'PNJ'}
                      </span>
                      <strong>{record.name}</strong>
                      {record.faction && (
                        <div
                          className={`inline-flex items-center gap-2 px-2 py-1 rounded-full text-sm font-medium ${getFactionColor(
                            record.faction.name
                          )}`}
                          style={{ width: "fit-content" }}
                        >
                          <span className="w-2 h-2 rounded-full bg-current"></span>
                          {record.faction.name}
                        </div>
                      )}
                    </div>
                    <span className="text-sm text-gray-500">
                      Created: {new Date(record.createdAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p>No recent records found.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
