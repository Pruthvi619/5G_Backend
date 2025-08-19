// server.js (ES Module for Railway)
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import csv from "csv-parser";

const app = express();
app.use(cors());
app.use(express.json());

// ES module __dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Utility to convert degrees to radians
function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

// Haversine distance in meters
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  const Δλ = toRadians(lon2 - lon1);
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Load CSV Dataset into Memory
let measurements = [];
const csvPath = path.join(__dirname, "norwich_cleaned_data.csv"); // Railway-friendly path
fs.createReadStream(csvPath)
  .pipe(csv())
  .on("data", (row) => {
    const lat = parseFloat(row.latitude?.trim());
    const lon = parseFloat(row.longitude?.trim());
    const operator = row.operator?.trim() || "";
    const rsrp = parseFloat(row.rsrp?.trim());

    if (!isNaN(lat) && !isNaN(lon) && !isNaN(rsrp)) {
      measurements.push({ lat, lon, operator, rsrp });
    }
  })
  .on("end", () => {
    console.log(`✅ Loaded ${measurements.length} rows from CSV dataset`);
  });

// Generate Hex Grid
function generateHexGrid(centerLat, centerLon, areaWidthKm, areaHeightKm, hexSizeKm, userLat, userLon, network, operator) {
  const degPerKmLat = 1 / 111;
  const degPerKmLon = 1 / (111 * Math.cos(toRadians(centerLat)));
  hexSizeKm = hexSizeKm || 0.05;

  const halfWidthDeg = (areaWidthKm / 2) * degPerKmLon;
  const halfHeightDeg = (areaHeightKm / 2) * degPerKmLat;

  const minLat = centerLat - halfHeightDeg;
  const maxLat = centerLat + halfHeightDeg;
  const minLon = centerLon - halfWidthDeg;
  const maxLon = centerLon + halfWidthDeg;

  const sideLengthLat = hexSizeKm * degPerKmLat;
  const sideLengthLon = hexSizeKm * degPerKmLon;

  const dx = 1.5 * sideLengthLon;
  const dy = Math.sqrt(3) * sideLengthLat;

  const cols = Math.floor((maxLon - minLon) / dx) + 2;
  const rows = Math.floor((maxLat - minLat) / dy) + 2;

  const hexCenters = [];
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      let lon = minLon + col * dx;
      let lat = minLat + row * dy;
      if (col % 2 === 1) lat += dy / 2;
      if (lon <= maxLon && lat <= maxLat) hexCenters.push([lon, lat]);
    }
  }

  const features = hexCenters.map(([lon, lat]) => {
    let nearestHexData = null;
    let minDistHex = Infinity;

    for (const m of measurements) {
      if (m.operator.toLowerCase() === operator.toLowerCase()) {
        const dist = haversine(lat, lon, m.lat, m.lon);
        if (dist < minDistHex) {
          minDistHex = dist;
          nearestHexData = m;
        }
      }
    }

    const hexCoords = [];
    for (let j = 0; j < 6; j++) {
      hexCoords.push([
        lon + sideLengthLon * Math.cos(toRadians(60 * j)),
        lat + sideLengthLat * Math.sin(toRadians(60 * j)),
      ]);
    }
    hexCoords.push(hexCoords[0]);

    return {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [hexCoords] },
      properties: { value: nearestHexData?.rsrp || null, center: [lon, lat] },
    };
  });

  return { type: "FeatureCollection", features };
}

// API Endpoint
app.post("/api/generate-hexgrid", (req, res) => {
  const { lat, lon, width, height, hex_size, user_lat, user_lon, network, operator } = req.body;

  if (![lat, lon, width, height, hex_size, user_lat, user_lon].every((val) => typeof val === "number")) {
    return res.status(400).json({ error: "Latitude, longitude, width, height, and hex size must be numbers." });
  }

  const result = generateHexGrid(lat, lon, width, height, hex_size, user_lat, user_lon, network, operator);
  res.json(result);
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
