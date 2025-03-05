"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function DashboardSummary() {
  const [recentData, setRecentData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");

  const fetchRecentData = async (model, days = 7) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/recent?model=${model}&days=${days}`);
      if (response.ok) {
        const data = await response.json();
        setRecentData(data);
      } else {
        console.error("Failed to fetch recent data:", await response.text());
      }
    } catch (error) {
      console.error("Error fetching recent data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecentData("Characters", 7);
  }, []);

  const filteredData = recentData.filter(record => {
    if (filter === "pj") return record.targetId > 0;
    if (filter === "pnj") return record.targetId < 0;
    return true;
  });

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
