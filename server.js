const express = require("express");
const cors = require("cors");
const fs = require("fs");
const csv = require("csv-parser"); // npm install csv-parser
const app = express();

app.use(cors());
app.use(express.json());

// Utility to convert degrees to radians
function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

// Haversine distance in meters
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000; // meters
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

// ====== Load CSV Dataset into Memory ======
let measurements = []; // { lat, lon, operator, rsrp }
fs.createReadStream("norwich_cleaned_data.csv")
  .pipe(csv())
  .on("data", (row) => {
    const lat = parseFloat(row.latitude?.trim());
    const lon = parseFloat(row.longitude?.trim());
    const operator = row.operator ? row.operator.trim() : "";
    const rsrp = parseFloat(row.rsrp?.trim());

    if (!isNaN(lat) && !isNaN(lon) && !isNaN(rsrp)) {
      measurements.push({ lat, lon, operator, rsrp });
    }
  })
  .on("end", () => {
    console.log(`✅ Loaded ${measurements.length} rows from CSV dataset`);
  });

// ====== Generate Hex Grid ======
// ====== Generate Hex Grid ======
function generateHexGrid(centerLat, centerLon, areaWidthKm, areaHeightKm, hexSizeKm, userLat, userLon, network, operator) {
  const degPerKmLat = 1 / 111;
  const degPerKmLon = 1 / (111 * Math.cos(toRadians(centerLat)));
  hexSizeKm = hexSizeKm || 0.05; // Default hex size

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

  // Generate hex centers
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      let lon = minLon + col * dx;
      let lat = minLat + row * dy;
      if (col % 2 === 1) lat += dy / 2;
      if (lon <= maxLon && lat <= maxLat) {
        hexCenters.push([lon, lat]);
      }
    }
  }

  // Find nearest dataset point to user
  let nearestData = null;
  let minDist = Infinity;
  for (const m of measurements) {
    if (m.operator.toLowerCase() === operator.toLowerCase()) {
      const dist = haversine(userLat, userLon, m.lat, m.lon);
      if (dist < minDist) {
        minDist = dist;
        nearestData = m;
      }
    }
  }

  // Convert hex centers to GeoJSON polygons and mark nearest hex
  const features = hexCenters.map(([lon, lat]) => {
    const hexCoords = [];
    for (let j = 0; j < 6; j++) {
      hexCoords.push([
        lon + sideLengthLon * Math.cos(toRadians(60 * j)),
        lat + sideLengthLat * Math.sin(toRadians(60 * j)),
      ]);
    }
    hexCoords.push(hexCoords[0]); // Close polygon

    // Check if this hex is nearest to the user's nearest point
    const isNearest = nearestData ? (Math.abs(lat - nearestData.lat) < 1e-6 && Math.abs(lon - nearestData.lon) < 1e-6) : false;

    return {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [hexCoords],
      },
      properties: {
        value: nearestData ? nearestData.rsrp : null, // assign actual RSRP
        center: [lon, lat],
        isNearest: nearestData && lon === nearestData.lon && lat === nearestData.lat
      },
      
    };
  });

  return {
    type: "FeatureCollection",
    features: features,
    nearest: nearestData ? {
      center: [nearestData.lon, nearestData.lat],
      value: nearestData.rsrp
    } : null
  };
}



// ====== API Endpoint ======
app.post("/api/generate-hexgrid", (req, res) => {
  const {
    lat,
    lon,
    width,
    height,
    hex_size,
    user_lat,
    user_lon,
    network,
    operator,
  } = req.body;

  if (
    ![lat, lon, width, height, hex_size, user_lat, user_lon].every(
      (val) => typeof val === "number"
    )
  ) {
    return res.status(400).json({
      error:
        "Invalid input. Latitude, longitude, width, height, and hex size must be numbers.",
    });
  }

  const result = generateHexGrid(
    lat,
    lon,
    width,
    height,
    hex_size,
    user_lat,
    user_lon,
    network,
    operator
  );

  console.log("Nearest point found:", result.nearest);
  console.log(
    "Nearest RSRP:",
    result.nearest ? result.nearest.value : "NO MATCH"
  );

  res.json(result);
});

// ====== Start Server ======
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`✅ Backend running on http://localhost:${PORT}`)
);