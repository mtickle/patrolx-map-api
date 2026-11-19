require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');
const { decodeNature } = require('./emdCodes');

const app = express();
app.use(cors());
app.use(express.json());

// PostgreSQL Pool (supports self-signed TLS certs in K3s and Aiven)
const connectionString = (process.env.DATABASE_URL || '').replace(/\?sslmode=(require|no-verify)$/, '');
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000
});

// Prevent idle socket drops (e.g., kubectl port-forward or pod restarts) from crashing Node
pool.on('error', (err) => {
  console.error('Unexpected idle PostgreSQL client error:', err.message);
});

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

// Middleware: Check x-api-key header
const requireApiKey = (req, res, next) => {
  const configuredKey = process.env.API_KEY;
  const clientKey = req.headers['x-api-key'] || req.query.apiKey;
  if (configuredKey && clientKey !== configuredKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }
  next();
};

function normalizeIncident(row) {
  let details = row.details;
  if (typeof details === 'string') {
    try { details = JSON.parse(details); } catch { details = {}; }
  }

  const raw = details?.raw_incident || details || {};
  const weather = details?.weather || {};

  const roadway = raw.RoadwayName || raw.road || row.address || 'Wake County Roadway';
  const direction = raw.DirectionOfTravel && raw.DirectionOfTravel !== 'Unknown'
    ? ` (${raw.DirectionOfTravel})`
    : '';

  const eventSubType = raw.EventSubType || raw.incidentType || row.event_type || 'Incident';
  const rawDescription = raw.Description || raw.problem || raw.reason || row.problem_detail || '';
  const decoded = decodeNature(rawDescription) || decodeNature(eventSubType) || decodeNature(row.event_type);
  const displayNature = decoded || eventSubType;

  const rawSev = String(raw.Severity ?? raw.severity ?? '').toLowerCase();
  let severityLevel = 'low';
  if (['3', 'high', 'major', 'severe'].includes(rawSev) || (decoded && decoded.includes('High Mechanism'))) {
    severityLevel = 'high';
  } else if (['2', 'medium', 'moderate'].includes(rawSev)) {
    severityLevel = 'medium';
  }

  return {
    id: row.id,
    source: row.source,
    source_id: row.source_id,
    status: row.status,
    county: 'Wake',
    jurisdiction: row.jurisdiction || raw.jurisdiction || raw.County || 'Wake County',
    title: `${roadway}${direction} - ${displayNature}`,
    roadway: `${roadway}${direction}`,
    event_type: eventSubType,
    decoded_nature: displayNature,
    description: rawDescription || row.address || 'Active incident reported.',
    severity: severityLevel,
    severity_rank: SEVERITY_RANK[severityLevel] || 1,
    latitude: Number(row.latitude || raw.Latitude || raw.latitude),
    longitude: Number(row.longitude || raw.Longitude || raw.longitude),
    timestamp: row.timestamp,
    weather_temp: row.weather_temp ?? weather.temperature ?? null,
    weather_wind: row.weather_wind_speed ?? weather.windSpeed ?? null,
    weather_forecast: row.weather_forecast ?? weather.shortForecast ?? null
  };
}

// 1. GET /api/active-incidents?limit=150&sort=severity
app.get('/api/active-incidents', requireApiKey, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 150, 400);
    const sortBy = req.query.sort || 'time';

    const query = `
      SELECT *
      FROM unified_incidents
      WHERE status = 'active'
        AND timestamp >= NOW() - INTERVAL '2 hours'
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT $1
    `;
    const { rows } = await pool.query(query, [limit]);

    const incidents = rows
      .map(normalizeIncident)
      .filter((inc) => !Number.isNaN(inc.latitude) && !Number.isNaN(inc.longitude));

    if (sortBy === 'severity') {
      incidents.sort((a, b) => {
        if (b.severity_rank !== a.severity_rank) return b.severity_rank - a.severity_rank;
        return new Date(b.timestamp) - new Date(a.timestamp);
      });
    } else {
      incidents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    res.json(incidents);
  } catch (err) {
    console.error('Error fetching active incidents:', err);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// 2. GET /api/cameras?lat=...&lng=...&limit=400
app.get('/api/cameras', requireApiKey, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 400, 800);

    const WAKE_LNG = -78.6382;
    const WAKE_LAT = 35.7796;

    const minLat = parseFloat(req.query.minLat);
    const maxLat = parseFloat(req.query.maxLat);
    const minLng = parseFloat(req.query.minLng);
    const maxLng = parseFloat(req.query.maxLng);
    const hasBounds = [minLat, maxLat, minLng, maxLng].every((v) => !Number.isNaN(v));

    const centerLat = !Number.isNaN(parseFloat(req.query.lat)) ? parseFloat(req.query.lat) : WAKE_LAT;
    const centerLng = !Number.isNaN(parseFloat(req.query.lng)) ? parseFloat(req.query.lng) : WAKE_LNG;

    let query;
    let params;

    if (hasBounds) {
      query = `
        SELECT id, name, latitude, longitude, image_url
        FROM traffic_cameras
        WHERE geom IS NOT NULL
          AND ST_Intersects(
            geom,
            ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
          )
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography ASC
        LIMIT $7
      `;
      params = [minLng, minLat, maxLng, maxLat, centerLng, centerLat, limit];
    } else {
      query = `
        SELECT id, name, latitude, longitude, image_url
        FROM traffic_cameras
        WHERE geom IS NOT NULL
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography ASC
        LIMIT $3
      `;
      params = [WAKE_LNG, WAKE_LAT, limit];
    }

    const { rows } = await pool.query(query, params);

    const cameras = rows.map((cam) => ({
      id: cam.id,
      name: cam.name,
      latitude: Number(cam.latitude),
      longitude: Number(cam.longitude),
      image_url: cam.image_url,
      proxy_url: `/api/camera-proxy?url=${encodeURIComponent(cam.image_url)}`
    }));

    res.json(cameras);
  } catch (err) {
    console.error('Error fetching cameras:', err.message);
    res.status(500).json({ error: 'Failed to load cameras' });
  }
});

// 3. GET /api/camera-proxy?url=...
app.get('/api/camera-proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url parameter');

  try {
    const separator = targetUrl.includes('?') ? '&' : '?';
    const cacheBustedUrl = `${targetUrl}${separator}t=${Date.now()}`;

    const response = await axios.get(cacheBustedUrl, {
      responseType: 'arraybuffer',
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Fedora; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
        'Referer': 'https://drivenc.gov/',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
      }
    });

    res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.send(Buffer.from(response.data));
  } catch (err) {
    console.error('Camera proxy error:', err.message);
    res.status(502).send('Failed to fetch camera frame');
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`PatrolX Map API listening on port ${PORT}`);
});