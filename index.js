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
app.use(cors({ origin: '*' })); // ✅ Allow all origins for now
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

// ✅ Google Sheets authentication
const processedKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: processedKey,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// ✅ Office locations (geofence)
const OFFICE_LOCATIONS = [
  { name: 'Head Office', lat: 9.429241474535132, long: -1.0533786340817441, radius: 0.15 },
  { name: 'Nyankpala', lat: 9.404691157748209, long: -0.9838639320946208, radius: 0.15 },
];

// ✅ Utility functions
function toRad(value) {
  return value * Math.PI / 180;
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getOfficeName(lat, long) {
  return (
    OFFICE_LOCATIONS.find(
      office => getDistance(lat, long, office.lat, office.long) <= office.radius
    )?.name || null
  );
}

// ✅ Attendance API
app.post('/api/attendance/web', async (req, res) => {
  const { action, latitude, longitude, timestamp, subjectId } = req.body;
  console.log(`📥 Attendance request: ${action} | ${subjectId} | ${latitude}, ${longitude}`);

  if (!action || isNaN(latitude) || isNaN(longitude) || !subjectId) {
    return res.status(400).json({ success: false, message: 'Invalid input.' });
  }

  try {
    // ✅ Load staff data
    const staffDoc = new GoogleSpreadsheet(process.env.STAFF_SHEET_ID, serviceAccountAuth);
    await staffDoc.loadInfo();
    const staffSheet = staffDoc.sheetsByTitle['Staff Sheet'];
    const staffRows = await staffSheet.getRows();

    // Match by either Name or ID
    const staffMember = staffRows.find(
      row => (row.get('Name') === subjectId || row.get('User ID') === subjectId) && row.get('Active') === 'Yes'
    );

    if (!staffMember) {
      return res.status(403).json({ success: false, message: 'Staff not found or inactive.' });
    }

    const name = staffMember.get('Name');
    const department = staffMember.get('Department') || 'Unknown';
    const allowedLocations = staffMember.get('Allowed Locations')?.split(',').map(l => l.trim()) || [];
    const officeName = getOfficeName(latitude, longitude);

    if (!officeName || !allowedLocations.includes(officeName)) {
      return res.status(403).json({ success: false, message: `Not authorized to clock ${action} at ${officeName || 'this location'}.` });
    }

    // ✅ Attendance sheet
    const attendanceDoc = new GoogleSpreadsheet(process.env.ATTENDANCE_SHEET_ID, serviceAccountAuth);
    await attendanceDoc.loadInfo();
    const attendanceSheet = attendanceDoc.sheetsByTitle['Attendance Sheet'];
    const rows = await attendanceSheet.getRows();

    const dateStr = new Date(timestamp).toISOString().split('T')[0];
    const existingRow = rows.find(
      row => row.get('Time In')?.startsWith(dateStr) && row.get('Name') === name
    );

    if (action === 'clock in' && existingRow && existingRow.get('Time In')) {
      return res.json({ success: false, message: `Dear ${name}, you have already clocked in today.` });
    }

    if (action === 'clock out' && (!existingRow || !existingRow.get('Time In') || existingRow.get('Time Out'))) {
      return res.json({ success: false, message: `Dear ${name}, you haven't clocked in yet or already clocked out.` });
    }

    // ✅ Save record
    if (action === 'clock in') {
      await attendanceSheet.addRow({
        'User ID': staffMember.get('User ID'),
        Name: name,
        'Time In': timestamp,
        'Time Out': '',
        Location: officeName,
        Department: department,
      });
      console.log(`✅ ${name} clocked in at ${officeName}`);
      return res.json({ success: true, message: `Dear ${name}, you have successfully clocked in at ${new Date(timestamp).toLocaleTimeString()} at ${officeName}.` });
    }

    if (action === 'clock out') {
      existingRow.set('Time Out', timestamp);
      existingRow.set('Location', officeName);
      await existingRow.save();
      console.log(`✅ ${name} clocked out at ${officeName}`);
      return res.json({ success: true, message: `Dear ${name}, you have successfully clocked out at ${new Date(timestamp).toLocaleTimeString()} at ${officeName}.` });
    }

  } catch (error) {
    console.error('❌ Attendance error:', error.message);
    res.status(500).json({ success: false, message: `Server error: ${error.message}` });
  }
});

// ✅ Proxy for CompreFace
app.post('/api/proxy/face-recognition', async (req, res) => {
  const apiKey = '4f4766d9-fc3b-436a-b24e-f57851a1c865';
  const url = 'http://145.223.33.154:8081/api/v1/recognition/recognize?limit=5';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });
    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).json({ error: `Proxy error: ${error.message}` });
  }
});

// ✅ Fallback to frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎉 Tolon Attendance Server running on port ${PORT}`);
});
