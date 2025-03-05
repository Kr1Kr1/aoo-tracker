"use client";

import { useState, useEffect } from "react";

export default function Map() {
  const [mapData, setMapData] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fetch map data from the backend
  const fetchMapData = async (mapId = 1) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/maps/${mapId}`);
      if (response.ok) {
        const data = await response.json();
        setMapData(data.tiles);
      } else {
        console.error("Failed to fetch map data:", await response.text());
      }
    } catch (error) {
      console.error("Error fetching map data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMapData(); // Fetch map with default ID
  }, []);

  // Render tiles as SVG elements
  const renderTiles = () => {
    return mapData.map((tile) => (
      <image
        key={`${tile.x}-${tile.y}`}
        href={tile.href}
        x={tile.x * 50} // Assume tile width/height of 50
        y={tile.y * 50}
        width="50"
        height="50"
        style={{
          opacity: tile.metadata?.opacity || 1,
          pointerEvents: "none",
        }}
      />
    ));
  };

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-xl font-bold mb-4">Map</h1>
      {loading ? (
        <p>Loading...</p>
      ) : mapData.length > 0 ? (
        <div className="relative">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="550"
            height="550"
            style={{ backgroundColor: "#f0f0f0", border: "1px solid #ccc" }}
          >
            {renderTiles()}
          </svg>
        </div>
      ) : (
        <p>No map data available.</p>
      )}
    </div>
  );
}
