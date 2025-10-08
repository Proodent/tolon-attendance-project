// ==================== CONFIGURATION ====================
const OFFICE_LOCATIONS = [
  { name: 'Head Office', lat: 9.429241474535132, long: -1.0533786340817441, radius: 0.15 },
  { name: 'Nyankpala', lat: 9.404691157748209, long: -0.9838639320946208, radius: 0.15 },
  { name: 'Accra office', lat: 5.790586353761225, long: -0.15862287743592557, radius: 0.15 }
];

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

function getOfficeName(lat, long) {
  return OFFICE_LOCATIONS.find(office =>
    getDistance(lat, long, office.lat, office.long) <= office.radius
  )?.name || null;
}

// ==================== GLOBALS ====================
let watchId = null, video, canvas, popup, popupHeader, popupMessage, popupFooter, popupRetry;

// ==================== LOCATION WATCH ====================
async function startLocationWatch() {
  const status = document.getElementById('status');
  const location = document.getElementById('location');
  const clockIn = document.getElementById('clockIn');
  const clockOut = document.getElementById('clockOut');

  video = document.getElementById('video');
  canvas = document.getElementById('canvas');
  popup = document.getElementById('popup');
  popupHeader = document.getElementById('popupHeader');
  popupMessage = document.getElementById('popupMessage');
  popupFooter = document.getElementById('popupFooter');
  popupRetry = document.getElementById('popupRetry');

  if (!navigator.geolocation) {
    status.textContent = 'Geolocation not supported';
    clockIn.disabled = clockOut.disabled = true;
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      location.textContent = `Location: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      const office = getOfficeName(latitude, longitude);
      status.textContent = office ? `At ${office}` : 'Outside office area';
      clockIn.disabled = clockOut.disabled = !office;
      clockIn.style.opacity = clockOut.style.opacity = office ? '1' : '0.6';
    },
    (err) => {
      status.textContent = `Error: ${err.message}`;
      clockIn.disabled = clockOut.disabled = true;
    },
    { enableHighAccuracy: true, maximumAge: 10000 }
  );

  document.getElementById('clockIn').addEventListener('click', () => handleClock('clock in'));
  document.getElementById('clockOut').addEventListener('click', () => handleClock('clock out'));
}

// ==================== CAMERA & FACE VALIDATION ====================
async function startVideo() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    video.srcObject = stream;
    video.style.transform = 'scaleX(-1)';
    await video.play();
  } catch (err) {
    showPopup('Verification Unsuccessful', `Camera error: ${err.message}`, true);
    throw err;
  }
}

function stopVideo() {
  if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
  video.srcObject = null;
}

async function validateFace(imageData) {
  try {
    const response = await fetch('/api/proxy/face-recognition', {
      method: 'POST',
      headers: { 'x-api-key': '4f4766d9-fc3b-436a-b24e-f57851a1c865', 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageData })
    });
    const result = await response.json();
    console.log('Face API response:', result);

    if (result?.result?.[0]?.subjects?.[0]) {
      const match = result.result[0].subjects[0];
      if (match.similarity >= 0.7) return { success: true, name: match.subject };
      else return { success: false, error: 'Face match too low. Try again.' };
    }
    return { success: false, error: 'No matching face found.' };
  } catch (err) {
    return { success: false, error: `Face API error: ${err.message}` };
  }
}

// ==================== ATTENDANCE HANDLER ====================
async function handleClock(action) {
  const faceRecognition = document.getElementById('faceRecognition');
  const [latStr, lonStr] = document.getElementById('location').textContent.replace('Location: ', '').split(', ');
  const latitude = parseFloat(latStr);
  const longitude = parseFloat(lonStr);
  const officeName = getOfficeName(latitude, longitude);

  if (!officeName) return showPopup('Location Error', 'You are outside an office zone.', true);

  faceRecognition.style.display = 'block';
  await startVideo();

  const canvasTemp = document.createElement('canvas');
  canvasTemp.width = 640;
  canvasTemp.height = 480;
  const ctx = canvasTemp.getContext('2d');
  ctx.scale(-1, 1);
  ctx.drawImage(video, -canvasTemp.width, 0, canvasTemp.width, canvasTemp.height);
  const imageData = canvasTemp.toDataURL('image/jpeg').split(',')[1];
  stopVideo();

  const face = await validateFace(imageData);
  if (!face.success) return showPopup('Verification Unsuccessful', face.error, true);

  // Send to backend for Google Sheets verification
  try {
    const response = await fetch('/api/attendance/web', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        name: face.name,
        latitude,
        longitude,
        officeName,
        timestamp: new Date().toISOString()
      })
    });

    const result = await response.json();
    if (result.success)
      showPopup('Verification Successful',
        `Dear ${face.name}, you have successfully ${action} at ${new Date().toLocaleTimeString()} in ${officeName}.`);
    else
      showPopup('Verification Unsuccessful', result.message || 'Attendance not logged.', true);

  } catch (err) {
    showPopup('Server Error', `Failed to log attendance: ${err.message}`, true);
  }
}

// ==================== POPUP HELPER ====================
function showPopup(title, message, retry = false) {
  popupHeader.textContent = title;
  popupMessage.textContent = message;
  popupFooter.textContent = new Date().toLocaleString();
  popupRetry.innerHTML = retry ? '<button onclick="window.location.reload()">Retry</button>' : '';
  popup.style.display = 'block';
  setTimeout(() => popup.style.display = 'none', retry ? 8000 : 5000);
}

// ==================== CLEANUP ====================
window.onload = startLocationWatch;
window.onunload = () => {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  stopVideo();
};
