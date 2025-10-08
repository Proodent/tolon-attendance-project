// backend/index.js
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

// ✅ Config
app.use(cors({ origin: 'https://tolon-attendance.proodentit.com' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
const PORT = process.env.PORT || 3000;

// ✅ Google Sheets Auth
const processedKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: processedKey,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

// ✅ Utility functions
function toRad(value) { return value * Math.PI / 180; }
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function loadOfficeLocations() {
  const doc = new GoogleSpreadsheet(process.env.STAFF_SHEET_ID);
  await doc.useServiceAccountAuth(serviceAccountAuth);
  await doc.loadInfo();
  const locationSheet = doc.sheetsByTitle['Locations'];
  const rows = await locationSheet.getRows();
  return rows.map(row => ({
    name: row.get('Location Name'),
    lat: parseFloat(row.get('Latitude')),
    long: parseFloat(row.get('Longitude')),
    radius: parseFloat(row.get('Radius (km)')) || 0.15
  }));
}

function getOfficeName(lat, long, offices) {
  return (
    offices.find(
      office => getDistance(lat, long, office.lat, office.long) <= office.radius
    )?.name || null
  );
}

// ✅ Attendance API
app.post('/api/attendance/web', async (req, res) => {
  const { action, latitude, longitude, timestamp, subjectName } = req.body;
  console.log(`📥 Attendance request: ${action} | ${subjectName}`);

  if (!action || isNaN(latitude) || isNaN(longitude) || !subjectName) {
    return res.status(400).json({ success: false, message: 'Invalid input. Please try again!' });
  }

  try {
    // Load office locations dynamically
    const officeLocations = await loadOfficeLocations();

    // Load staff sheet
    const staffDoc = new GoogleSpreadsheet(process.env.STAFF_SHEET_ID);
    await staffDoc.useServiceAccountAuth(serviceAccountAuth);
    await staffDoc.loadInfo();
    const staffSheet = staffDoc.sheetsByTitle['Staff Sheet'];
    const staffRows = await staffSheet.getRows();

    const staff = staffRows.find(
      row => row.get('Name') === subjectName && row.get('Active') === 'Yes'
    );

    if (!staff) {
      return res.status(403).json({ success: false, message: 'Staff not found or inactive.' });
    }

    const department = staff.get('Department') || 'Unknown';
    const allowed = staff.get('Allowed Locations')?.split(',').map(x => x.trim()) || [];
    const officeName = getOfficeName(latitude, longitude, officeLocations);

    if (!officeName || !allowed.includes(officeName)) {
      return res.status(403).json({
        success: false,
        message: `Not authorized to clock ${action} at ${officeName || 'this location'}.`
      });
    }

    // Load attendance sheet
    const attendanceDoc = new GoogleSpreadsheet(process.env.ATTENDANCE_SHEET_ID);
    await attendanceDoc.useServiceAccountAuth(serviceAccountAuth);
    await attendanceDoc.loadInfo();
    const sheet = attendanceDoc.sheetsByTitle['Attendance Sheet'];
    const rows = await sheet.getRows();

    const dateStr = new Date(timestamp).toISOString().split('T')[0];
    const userRow = rows.find(row =>
      row.get('Date') === dateStr && row.get('Name') === subjectName
    );

    const timeFormatted = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Handle clock in
    if (action === 'clock in') {
      if (userRow && userRow.get('Time In')) {
        return res.json({ success: false, message: `Dear ${subjectName}, you have already clocked in today.` });
      }
      await sheet.addRow({
        Name: subjectName,
        Date: dateStr,
        'Time In': timestamp,
        'Time Out': '',
        Location: officeName,
        Department: department
      });
      return res.json({
        success: true,
        message: `Dear ${subjectName}, you have successfully clocked in at ${timeFormatted} in ${officeName}.`
      });
    }

    // Handle clock out
    if (action === 'clock out') {
      if (!userRow || !userRow.get('Time In')) {
        return res.json({ success: false, message: `Dear ${subjectName}, you haven't clocked in yet.` });
      }
      if (userRow.get('Time Out')) {
        return res.json({ success: false, message: `Dear ${subjectName}, you have already clocked out today.` });
      }

      userRow.set('Time Out', timestamp);
      await userRow.save();
      return res.json({
        success: true,
        message: `Dear ${subjectName}, you have successfully clocked out at ${timeFormatted} in ${officeName}.`
      });
    }

    res.status(400).json({ success: false, message: 'Invalid action.' });

  } catch (err) {
    console.error('❌ Attendance error:', err.message);
    res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

// ✅ Proxy to CompreFace
app.post('/api/proxy/face-recognition', async (req, res) => {
  try {
    const response = await fetch(
      `${process.env.COMPREFACE_URL}/api/v1/recognition/recognize?limit=5`,
      {
        method: 'POST',
        headers: {
          'x-api-key': process.env.COMPREFACE_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(req.body)
      }
    );
    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).json({ error: `Proxy error: ${error.message}` });
  }
});

// ✅ Fallback to frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎉 Tolon Attendance Server running on port ${PORT}`);
});
