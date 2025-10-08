import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

let officesCache = null;

async function fetchOfficeLocations() {
  if (officesCache) return officesCache;

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'Locations!A2:D', // Name | Lat | Long | Radius(km)
  });

  officesCache = res.data.values.map(row => ({
    name: row[0],
    lat: parseFloat(row[1]),
    long: parseFloat(row[2]),
    radius: parseFloat(row[3]) || 0.15,
  }));

  return officesCache;
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function getOfficeName(lat, long) {
  const offices = await fetchOfficeLocations();
  return (
    offices.find(
      office => getDistance(lat, long, office.lat, office.long) <= office.radius
    )?.name || null
  );
}
