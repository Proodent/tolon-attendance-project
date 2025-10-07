// index.js
import express from 'express';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import 'dotenv/config';
import cors from 'cors';
import fetch from 'node-fetch';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ✅ Allow frontend access
app.use(cors({ origin: 'https://tolon-attendance.proodentit.com' }));
app.use(express.json({ limit: '10mb' })); // to handle base64 images

// ✅ Serve your frontend files (from root)
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

// ✅ Setup Google Sheets authentication
const processedKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: processedKey,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

// ✅ Define office locations (geofencing)
const OFFICE_LOCATIONS = [
  { name: 'Head Office', lat: 9.429241474535132, long: -1.0533786340817441, radius: 0.15 },
  { name: 'Nyankpala', lat: 9.404691157748209, long: -0.9838639320946208, radius: 0.15 }
];

function toRad(value) {
  return value * Math.PI / 180;
}
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
function getOfficeName(lat, long) {
  return OFFICE_LOCATIONS.find(office =>
    getDistance(lat, long, office.lat, office.long) <= office.radius
  )?.name || null;
}

// ✅ Face Recognition via CompreFace
app.post('/api/recognize', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ success: false, message: 'No image provided' });

    const apiKey = '4f4766d9-fc3b-436a-b24e-f57851a1c865';
    const url = 'http://145.223.33.154:8081/api/v1/recognition/recognize?limit=5';

    const agent = new https.Agent({ rejectUnauthorized: false });
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file: imageBase64 }),
      agent: url.startsWith('http:') ? agent : undefined
    });

    const data = await response.json();
    if (!data.result || !data.result.length) {
      return res.json({ success: false, message: 'No matching face found' });
    }

    const match = data.result[0].subjects?.[0];
    if (!match || match.similarity < 0.8) {
      return res.json({ success: false, message: 'Face not recognized or too low similarity' });
    }

    const subjectId = match.subject;
    res.json({ success: true, subjectId });
  } catch (err) {
    console.error('Recognition error:', err.message);
    res.status(500).json({ success: false, message: `Recognition error: ${err.message}` });
  }
});

// ✅ Attendance Handler (with face + location)
app.post('/api/attendance/web', async (req, res) => {
  const { action, latitude, longitude, timestamp, subjectId } = req.body;

  if (!action || !latitude || !longitude || !subjectId) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    // Load staff info
    const staffDoc = new GoogleSpreadsheet(process.env.STAFF_SHEET_ID, serviceAccountAuth);
    await staffDoc.loadInfo();
    const staffSheet = staffDoc.sheetsByTitle['Staff Sheet'];
    const staffRows = await staffSheet.getRows();
    const staffMember = staffRows.find(row => row.get('Name') === subjectId && row.get('Active') === 'Yes');

    if (!staffMember) {
      return res.status(403).json({ success: false, message: 'Staff not found or inactive' });
    }

    const allowedLocations = staffMember.get('Allowed Locations')?.split(',').map(l => l.trim()) || [];
    const officeName = getOfficeName(latitude, longitude);
    if (!officeName || !allowedLocations.includes(officeName)) {
      return res.status(403).json({ success: false, message: `Not authorized at this location: ${officeName}` });
    }

    const department = staffMember.get('Department') || 'Unknown';
    const attendanceDoc = new GoogleSpreadsheet(process.env.ATTENDANCE_SHEET_ID, serviceAccountAuth);
    await attendanceDoc.loadInfo();
    const attendanceSheet = attendanceDoc.sheetsByTitle['Attendance Sheet'];
    const dateStr = new Date(timestamp).toISOString().split('T')[0];
    const rows = await attendanceSheet.getRows();
    const existingRow = rows.find(r => r.get('Time In')?.startsWith(dateStr) && r.get('Name') === subjectId);

    if (action === 'clock in' && existingRow && existingRow.get('Time In')) {
      return res.json({ success: false, message: 'Already clocked in today.' });
    }

    if (action === 'clock out' && (!existingRow || existingRow.get('Time Out'))) {
      return res.json({ success: false, message: 'No valid clock-in found or already clocked out.' });
    }

    if (action === 'clock in') {
      await attendanceSheet.addRow({
        Name: subjectId,
        'Time In': timestamp,
        'Time Out': '',
        Location: officeName,
        Department: department
      });
      console.log(`✅ Clock-in: ${subjectId} at ${officeName}`);
      return res.json({ success: true, message: `Clocked in at ${officeName}` });
    }

    if (action === 'clock out' && existingRow) {
      existingRow.set('Time Out', timestamp);
      existingRow.set('Location', officeName);
      existingRow.set('Department', department);
      await existingRow.save();
      console.log(`✅ Clock-out: ${subjectId} at ${officeName}`);
      return res.json({ success: true, message: `Clocked out from ${officeName}` });
    }

  } catch (err) {
    console.error('Attendance error:', err.message);
    res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

// ✅ Serve index.html for all unmatched routes
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ✅ Start Server
app.listen(PORT, '0.0.0.0', () => console.log(`🎉 Tolon Attendance Server running on port ${PORT}`));
