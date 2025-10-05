import React, { useState } from "react";
import axios from "axios";
import { MapContainer, TileLayer, useMapEvents, Popup, Marker } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useNavigate } from "react-router-dom";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

// Fix Leaflet markers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Format YYYYMMDD → e.g., 3rd October 2025
function formatDateLabel(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd === -999) return "";
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  const date = new Date(y, m, d);
  const day = date.getDate();
  const month = date.toLocaleString("en-US", { month: "long" });
  const year = date.getFullYear();
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
      ? "nd"
      : day % 10 === 3 && day !== 13
      ? "rd"
      : "th";
  return `${day}${suffix} ${month} ${year}`;
}

// Helper functions for frontend POWER calculations
function deg2rad(d) { return d * Math.PI / 180; }
function rad2deg(r) { return r * 180 / Math.PI; }
function dayOfYear(d) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 0));
  const diff = d - start;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
function computeRa(latDeg, doy) {
  const Gsc = 0.0820;
  const lat = deg2rad(latDeg);
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
  const omega_s = Math.acos(-Math.tan(lat) * Math.tan(delta));
  return (24 * 60 / Math.PI) * Gsc * dr * (omega_s * Math.sin(lat) * Math.sin(delta) + Math.cos(lat) * Math.cos(delta) * Math.sin(omega_s));
}
function hargreavesETo(tmin, tmax, Ra) {
  const tmean = (tmin + tmax) / 2;
  const deltaT = Math.max(0, tmax - tmin);
  return 0.0023 * (tmean + 17.8) * Math.sqrt(deltaT) * Ra;
}

export default function MapPage() {
  const [location, setLocation] = useState(null);
  const [locationName, setLocationName] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [days, setDays] = useState(5);
  const [crop, setCrop] = useState("maize");
  const navigate = useNavigate();

  function LocationMarker() {
    useMapEvents({
      click: async (e) => {
        const { lat, lng } = e.latlng;
        setLocation({ lat, lng });
        setError("");
        setData(null);
        setLoading(true);

        try {
          // Reverse geocode
          const geoRes = await axios.get(
            "https://nominatim.openstreetmap.org/reverse",
            { params: { lat, lon: lng, format: "json" } }
          );

          const place =
            geoRes.data.display_name ||
            `${geoRes.data.address.city || geoRes.data.address.town || geoRes.data.address.village || "Unknown"}, ${geoRes.data.address.country || ""}`;

          setLocationName(place);

          // NASA POWER frontend fetch
          const end = new Date();
          const start = new Date();
          start.setUTCDate(end.getUTCDate() - (days - 1));

          const startStr = start.toISOString().slice(0,10).replace(/-/g,'');
          const endStr = end.toISOString().slice(0,10).replace(/-/g,'');

          const params = ["T2M_MAX","T2M_MIN","PRECTOT"];
          const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${params.join(",")}&community=AG&start=${startStr}&end=${endStr}&format=JSON&latitude=${lat}&longitude=${lng}`;
          
          const r = await axios.get(url);
          const json = r.data;

          // parse daily series
          const dates = [];
          const tmax = [];
          const tmin = [];
          const precip = [];
          const tmaxObj = json.properties.parameter.T2M_MAX || {};
          const tminObj = json.properties.parameter.T2M_MIN || {};
          const precObj = json.properties.parameter.PRECTOT || {};

          for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
            const key = d.toISOString().slice(0,10).replace(/-/g,'');
            dates.push(key);
            tmax.push(tmaxObj[key] ?? null);
            tmin.push(tminObj[key] ?? null);
            precip.push(precObj[key] ?? 0);
          }

          // Compute ETo & soil moisture
          const fc_mm = 150;
          const kc_map = { maize: 1.15, wheat: 0.8, grass: 1.0, default: 1.0 };
          const kc = kc_map[crop] || kc_map.default;
          let aw = fc_mm * 0.5;
          const soil_series = [];
          const eto_series = [];

          for (let i = 0; i < dates.length; i++) {
            const key = dates[i];
            const tmx = tmax[i];
            const tmn = tmin[i];
            const pr = precip[i] || 0;
            const dateObj = new Date(Date.UTC(+key.slice(0,4), +key.slice(4,6)-1, +key.slice(6,8)));
            const doy = dayOfYear(dateObj);

            let eto = (tmx !== null && tmn !== null) ? hargreavesETo(tmn, tmx, computeRa(lat, doy)) : 0;
            eto_series.push(+eto.toFixed(3));

            aw += pr;
            const etc = eto * kc;
            const actual_et = Math.min(aw, etc);
            aw -= actual_et;
            if (aw > fc_mm) aw = fc_mm;
            if (aw < 0) aw = 0;
            soil_series.push(+aw.toFixed(2));
          }

          const readableDates = dates.map(formatDateLabel);
          setData({ dates, tmax, tmin, precip, eto: eto_series, soil_moisture: soil_series, readableDates });
        } catch (err) {
          console.error(err);
          setError("❌ Failed to load NASA data");
        } finally {
          setLoading(false);
        }
      },
    });

    return location ? (
      <Marker position={[location.lat, location.lng]}>
        <Popup>
          <strong>{locationName || "Loading..."}</strong>
          <br />
          Lat: {location.lat.toFixed(2)}, Lon: {location.lng.toFixed(2)}
        </Popup>
      </Marker>
    ) : null;
  }

  const handleStartGame = () => {
    localStorage.setItem("selectedCrop", crop);
    localStorage.setItem("selectedDays", days);
    localStorage.setItem("selectedLocation", JSON.stringify(location));
    localStorage.setItem("selectedLocationName", locationName);
    localStorage.setItem("weatherData", JSON.stringify(data));
    navigate("/farm");
  };

  return (
    <div className="flex h-screen">
      <div className="flex-1">
        <MapContainer center={[6.5, 3.4]} zoom={5} className="h-full w-full">
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="© OpenStreetMap contributors"
          />
          <LocationMarker />
        </MapContainer>
      </div>

      <div className="w-[420px] border-l border-gray-300 bg-gray-50 p-6 flex flex-col justify-between">
        <div>
          <h1 className="text-2xl font-bold mb-4 text-green-700">🌾 NASA Smart Farm Setup</h1>
          <p className="text-sm mb-4 text-gray-600">
            Click anywhere on the map to select your farm location, crop, and number of days to simulate.
          </p>

          <label className="block mb-3 text-sm">
            🪴 Crop Type:
            <select
              value={crop}
              onChange={(e) => setCrop(e.target.value)}
              className="ml-2 border rounded px-2 py-1"
            >
              <option value="maize">🌽 Maize</option>
              <option value="rice">🌾 Rice</option>
              <option value="wheat">🌾 Wheat</option>
              <option value="soybean">🌱 Soybean</option>
              <option value="cassava">🥔 Cassava</option>
            </select>
          </label>

          <label className="block mb-4 text-sm">
            📅 Simulation Days:
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="ml-2 border rounded px-2 py-1"
            >
              {[5, 10, 15, 20, 30].map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>

          {location && (
            <div className="p-2 bg-white border rounded mb-3 text-sm shadow-sm">
              <p>📍 <b>Location:</b> {locationName}</p>
              <p className="text-xs text-gray-500">
                Lat: {location.lat.toFixed(2)}, Lon: {location.lng.toFixed(2)}
              </p>
            </div>
          )}

          {loading && (
            <div className="flex items-center space-x-2 text-blue-600 text-sm mb-3">
              <svg className="animate-spin h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              <span>⏳ Loading NASA data...</span>
            </div>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>

        <button
          disabled={!location || loading}
          onClick={handleStartGame}
          className={`w-full py-2 rounded text-white font-semibold transition ${
            !location || loading
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-green-600 hover:bg-green-700"
          }`}
        >
          🚜 {loading ? "Loading..." : "Start Simulation"}
        </button>
      </div>
    </div>
  );
}
