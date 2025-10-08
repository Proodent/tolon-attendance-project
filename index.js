// index.js
import express from 'express';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import 'dotenv/config';
import cors from 'cors';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Google Sheets authentication
const processedKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: processedKey,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

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
    radius: parseFloat(row.get('Radius (km)')) || 0.15,
  }));
}

function getOfficeName(lat, long, officeLocations) {
  return (
    officeLocations.find(
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
    // ✅ Load office locations from sheet
    const officeLocations = await loadOfficeLocations();

    // ✅ Load staff sheet
    const staffDoc = new GoogleSpreadsheet(process.env.STAFF_SHEET_ID);
    await staffDoc.useServiceAccountAuth(serviceAccountAuth);
    await staffDoc.loadInfo();
    const staffSheet = staffDoc.sheetsByTitle['Staff Sheet'];
    const staffRows = await staffSheet.getRows();

    const staffMember = staffRows.find(
      row => (row.get('Name') === subjectId || row.get('User ID') === subjectId) && row.get('Active') === 'Yes'
    );

    if (!staffMember) {
      return res.status(403).json({ success: false, message: 'Staff not found or inactive.' });
    }

    const name = staffMember.get('Name');
    const userId = staffMember.get('User ID');
    const department = staffMember.get('Department') || 'Unknown';
    const allowedLocations = staffMember.get('Allowed Locations')?.split(',').map(l => l.trim()) || [];

    const officeName = getOfficeName(latitude, longitude, officeLocations);

    if (!officeName || !allowedLocations.includes(officeName)) {
      return res.status(403).json({
        success: false,
        message: `Not authorized to clock ${action} at ${officeName || 'this location'}.`
      });
    }

    // ✅ Load attendance sheet
    const attendanceDoc = new GoogleSpreadsheet(process.env.ATTENDANCE_SHEET_ID);
    await attendanceDoc.useServiceAccountAuth(serviceAccountAuth);
    await attendanceDoc.loadInfo();
    const attendanceSheet = attendanceDoc.sheetsByTitle['Attendance Sheet'];
    const rows = await attendanceSheet.getRows();

    const dateStr = new Date(timestamp).toISOString().split('T')[0];
    const existingRow = rows.find(
      row => row.get('Date') === dateStr && row.get('User ID') === userId
    );

    const timeFormatted = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (action === 'clock in') {
      if (existingRow && existingRow.get('Time In')) {
        return res.json({ success: false, message: `Dear ${name}, you have already clocked in today.` });
      }

      await attendanceSheet.addRow({
        'User ID': userId,
        Name: name,
        Date: dateStr,
        'Time In': timestamp,
        'Time Out': '',
        Location: officeName,
        Department: department,
      });

      console.log(`✅ ${name} clocked in at ${officeName}`);
      return res.json({
        success: true,
        message: `Dear ${name}, you have successfully clocked in at ${timeFormatted} at ${officeName}.`
      });
    }

    if (action === 'clock out') {
      if (!existingRow || !existingRow.get('Time In')) {
        return res.json({ success: false, message: `Dear ${name}, you haven't clocked in yet.` });
      }
      if (existingRow.get('Time Out')) {
        return res.json({ success: false, message: `Dear ${name}, you have already clocked out today.` });
      }

      existingRow.set('Time Out', timestamp);
      existingRow.set('Location', officeName);
      await existingRow.save();

      console.log(`✅ ${name} clocked out at ${officeName}`);
      return res.json({
        success: true,
        message: `Dear ${name}, you have successfully clocked out at ${timeFormatted} at ${officeName}.`
      });
    }

    res.status(400).json({ success: false, message: 'Invalid action.' });

  } catch (error) {
    console.error('❌ Attendance error:', error.message);
    res.status(500).json({ success: false, message: `Server error: ${error.message}` });
  }
});

// ✅ Proxy for CompreFace
app.post('/api/proxy/face-recognition', async (req, res) => {
  const apiKey = process.env.COMPREFACE_API_KEY;
  const baseUrl = process.env.COMPREFACE_URL;

  try {
    const response = await fetch(`${baseUrl}/api/v1/recognition/recognize?limit=5`, {
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
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ✅ Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎉 Tolon Attendance Server running on port ${PORT}`);
});
