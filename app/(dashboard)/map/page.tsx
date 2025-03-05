"use client";

import { useState, useEffect } from "react";

export default function Map() {
  const [mapData, setMapData] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fake map data for testing
  const fakeMapData = [
    { x: 0, y: 0, href: "https://via.placeholder.com/50", metadata: { opacity: 1 } },
    { x: 1, y: 0, href: "https://via.placeholder.com/50?text=Tile2", metadata: { opacity: 0.8 } },
    { x: 0, y: 1, href: "https://via.placeholder.com/50?text=Tile3", metadata: { opacity: 0.6 } },
    { x: 1, y: 1, href: "https://via.placeholder.com/50?text=Tile4", metadata: { opacity: 1 } },
    { x: 2, y: 2, href: "https://via.placeholder.com/50?text=Tile5", metadata: { opacity: 0.9 } },
  ];

  // Simulate fetching map data
  const fetchMapData = async (mapId = 1) => {
    setLoading(true);
    try {
      // Simulate an async fetch with fake data
      await new Promise((resolve) => setTimeout(resolve, 500));
      setMapData(fakeMapData);
    } catch (error) {
      console.error("Error fetching map data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMapData(); // Fetch map with fake data
  }, []);

  // Render tiles as SVG elements
  const renderTiles = () => {
    return mapData.map((tile, index) => (
      <image
        key={`${tile.x}-${tile.y}-${index}`}
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
