import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

export async function logAttendance({ name, action, officeName, latitude, longitude, timestamp }) {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const date = new Date(timestamp);
    const formattedDate = date.toLocaleDateString();
    const formattedTime = date.toLocaleTimeString();

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Attendance!A:G',
      valueInputOption: 'RAW',
      requestBody: {
        values: [
          [name, action, officeName, formattedDate, formattedTime, latitude, longitude],
        ],
      },
    });

    return true;
  } catch (err) {
    console.error('Error logging attendance:', err);
    return false;
  }
}
