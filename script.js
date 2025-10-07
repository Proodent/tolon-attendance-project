// script.js
const video = document.getElementById('camera');
const messageBox = document.getElementById('message');
const clockInBtn = document.getElementById('clockIn');
const clockOutBtn = document.getElementById('clockOut');

const backendURL = 'https://tolon-attendance.proodentit.com/api'; // adjust if needed

// 🎥 Start the webcam
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
  } catch (err) {
    showMessage('Unable to access camera: ' + err.message, 'error');
  }
}

// 🖼️ Capture an image from the camera
function captureImage() {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg').split(',')[1]; // Base64 image string
}

// 🌍 Get user location (latitude, longitude)
function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
    } else {
      navigator.geolocation.getCurrentPosition(
        pos => resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude
        }),
        err => reject(err)
      );
    }
  });
}

// 🧠 Recognize face via backend
async function recognizeFace(imageBase64) {
  try {
    const response = await fetch(`${backendURL}/recognize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64 })
    });
    const data = await response.json();
    if (data.success) {
      return data.subjectId; // recognized user name
    } else {
      throw new Error(data.message || 'Face not recognized');
    }
  } catch (err) {
    throw new Error('Recognition failed: ' + err.message);
  }
}

// 🕒 Log attendance (clock in/out)
async function logAttendance(action, subjectId, latitude, longitude) {
  try {
    const timestamp = new Date().toISOString();
    const response = await fetch(`${backendURL}/attendance/web`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, subjectId, latitude, longitude, timestamp })
    });

    const data = await response.json();
    if (data.success) {
      showMessage(data.message, 'success');
    } else {
      showMessage(data.message, 'error');
    }
  } catch (err) {
    showMessage('Attendance error: ' + err.message, 'error');
  }
}

// 💬 Helper to show messages
function showMessage(text, type = 'info') {
  messageBox.textContent = text;
  messageBox.className = type;
}

// 🚀 Main function for clocking in/out
async function handleAttendance(action) {
  showMessage(`Processing ${action}...`, 'info');

  try {
    // Capture image
    const imageBase64 = captureImage();
    showMessage('Verifying face...', 'info');

    // Face recognition
    const subjectId = await recognizeFace(imageBase64);
    showMessage(`Welcome, ${subjectId}. Checking location...`, 'info');

    // Get location
    const { latitude, longitude } = await getLocation();

    // Send attendance
    await logAttendance(action, subjectId, latitude, longitude);

  } catch (err) {
    showMessage(err.message, 'error');
  }
}

// 🎯 Attach event listeners
clockInBtn.addEventListener('click', () => handleAttendance('clock in'));
clockOutBtn.addEventListener('click', () => handleAttendance('clock out'));

// 🎥 Start camera on load
startCamera();
