import express from 'express';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import 'dotenv/config';
import path from 'path';
import cors from 'cors';
import fetch from 'node-fetch';
import https from 'https';

const app = express();
app.use(express.json());
app.use(cors({ origin: 'https://tolon-attendance.proodentit.com' }));
app.use(express.static(path.join(__dirname, '../client')));

const PORT = process.env.PORT || 3000;


const processedKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: processedKey,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const OFFICE_LOCATIONS = [
  { name: 'Head Office', lat: 9.429241474535132, long: -1.0533786340817441, radius: 0.15 },
  { name: 'Nyankpala', lat: 9.404691157748209, long: -0.9838639320946208, radius: 0.15 }
];

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(value) {
  return value * Math.PI / 180;
}

function getOfficeName(lat, long) {
  return OFFICE_LOCATIONS.find(office =>
    getDistance(lat, long, office.lat, office.long) <= office.radius
  )?.name || null;
}

const faceDescriptors = {
  'user1': [0.1, 0.2, 0.3, /* ... */],
  'user2': [0.4, 0.5, 0.6, /* ... */]
};

app.post('/api/attendance/getFaceDescriptor', (req, res) => {
  const { username } = req.body;
  if (faceDescriptors[username]) {
    res.json({ success: true, descriptor: faceDescriptors[username] });
  } else {
    res.json({ success: false, message: 'No face data for this user' });
  }
});

app.post('/api/attendance/web', async (req, res) => {
  const { action, latitude, longitude, timestamp, subjectId } = req.body;
  console.log(`📥 Web attendance request: ${action} at ${latitude}, ${longitude}, subjectId: ${subjectId}`);

  if (!action || isNaN(latitude) || isNaN(longitude) || !subjectId) {
    return res.status(400).json({ success: false, message: 'Invalid input. Please try again!' });
  }

  try {
    const staffDoc = new GoogleSpreadsheet(process.env.STAFF_SHEET_ID, serviceAccountAuth);
    await staffDoc.loadInfo();
    const staffSheet = staffDoc.sheetsByTitle['Staff Sheet'];
    const staffRows = await staffSheet.getRows();
    const staffMember = staffRows.find(row => row.get('Name') === subjectId && row.get('Active') === 'Yes');

    if (!staffMember) {
      return res.status(403).json({ success: false, message: 'Staff member not found or not active.' });
    }

    const allowedLocations = staffMember.get('Allowed Locations')?.split(',').map(loc => loc.trim()) || [];
    const officeName = getOfficeName(latitude, longitude);
    if (!officeName || !allowedLocations.includes(officeName)) {
      return res.status(403).json({ success: false, message: `Not authorized to clock ${action} at ${officeName}.` });
    }

    const department = staffMember.get('Department') || 'Unknown';

    const attendanceDoc = new GoogleSpreadsheet(process.env.ATTENDANCE_SHEET_ID, serviceAccountAuth);
    await attendanceDoc.loadInfo();
    const attendanceSheet = attendanceDoc.sheetsByTitle['Attendance Sheet'];
    const dateStr = new Date(timestamp).toISOString().split('T')[0];
    const rows = await attendanceSheet.getRows();
    const userRow = rows.find(row => row.get('Time In')?.startsWith(dateStr) && row.get('Name') === subjectId);

    if (action === 'clock in' && userRow && userRow.get('Time In')) {
      return res.json({ success: false, message: 'You have already clocked in today.' });
    }
    if (action === 'clock out' && (!userRow || !userRow.get('Time In') || userRow.get('Time Out'))) {
      return res.json({ success: false, message: 'No clock-in found for today or already clocked out.' });
    }

    if (action === 'clock in') {
      try {
        await attendanceSheet.addRow({
          Name: subjectId,
          'Time In': timestamp,
          'Time Out': '',
          Location: officeName,
          Department: department
        });
        console.log('✅ Row added to Attendance Sheet for', subjectId, 'in', department);
        return res.json({ success: true, message: `Clocked in successfully at ${timestamp} at ${officeName}!` });
      } catch (rowError) {
        console.error('❌ Failed to add row:', rowError.message);
        return res.status(500).json({ success: false, message: `Error saving to sheet: ${rowError.message}. Contact admin!` });
      }
    } else if (action === 'clock out') {
      if (userRow) {
        try {
          userRow.set('Time Out', timestamp);
          userRow.set('Location', officeName);
          userRow.set('Department', department);
          await userRow.save();
          console.log('✅ Row updated with Time Out for', subjectId, 'in', department);
          return res.json({ success: true, message: `Clocked out successfully at ${timestamp} at ${officeName}!` });
        } catch (rowError) {
          console.error('❌ Failed to update row:', rowError.message);
          return res.status(500).json({ success: false, message: `Error updating sheet: ${rowError.message}. Contact admin!` });
        }
      }
    }
  } catch (error) {
    console.error('❌ Web attendance error:', error.message);
    return res.status(500).json({ success: false, message: `Server error: ${error.message}. Please try again or contact admin!` });
  }
});

app.post('/api/proxy/face-recognition', async (req, res) => {
  const apiKey = '4f4766d9-fc3b-436a-b24e-f57851a1c865';
  const url = 'http://145.223.33.154:8081/api/v1/recognition/recognize?limit=5';
  console.log('Proxy request received:', req.body);
  try {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
      agent: url.startsWith('http:') ? agent : undefined
    });
    const result = await response.json();
    console.log('Proxy response:', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: result
    });
    res.json(result);
  } catch (error) {
    console.error('Proxy fetch error:', {
      message: error.message,
      name: error.name,
      stack: error.stack,
      url: url,
      requestBody: req.body,
      isMixedContent: true
    });
    res.status(500).json({ error: `Proxy error: ${error.message}` });
  }
});

app.get('/', (req, res) => {
  res.status(200).send('✅ Tolon Attendance Server is running fine!');
});


app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎉 Web attendance server running on http://0.0.0.0:${PORT}`);
});
