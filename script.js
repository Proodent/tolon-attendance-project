// Office locations
const OFFICE_LOCATIONS = [
  { name: 'Head Office', lat: 9.429241474535132, long: -1.0533786340817441, radius: 0.15 },
  { name: 'Nyankpala', lat: 9.404691157748209, long: -0.9838639320946208, radius: 0.15 },
  { name: 'Accra office', lat: 5.790586353761225, long: -0.15862287743592557, radius: 0.15 }
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

let watchId = null;
let video, canvas, popup, popupHeader, popupMessage, popupFooter, popupRetry, diagnostic;

async function startLocationWatch() {
  const status = document.getElementById('status');
  const location = document.getElementById('location');
  const clockIn = document.getElementById('clockIn');
  const clockOut = document.getElementById('clockOut');
  video = document.getElementById('video');
  canvas = document.getElementById('canvas');
  const faceMessage = document.getElementById('faceMessage');
  const faceRecognition = document.getElementById('faceRecognition');
  const message = document.getElementById('message');
  popup = document.getElementById('popup');
  popupHeader = document.getElementById('popupHeader');
  popupMessage = document.getElementById('popupMessage');
  popupFooter = document.getElementById('popupFooter');
  popupRetry = document.getElementById('popupRetry');
  diagnostic = document.getElementById('diagnostic');

  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        location.textContent = `Location: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        const office = getOfficeName(latitude, longitude);
        status.textContent = office ? `At ${office}` : 'Outside office area';
        const isAtOffice = !!office;
        clockIn.disabled = !isAtOffice;
        clockOut.disabled = !isAtOffice;
        clockIn.style.opacity = isAtOffice ? '1' : '0.6';
        clockOut.style.opacity = isAtOffice ? '1' : '0.6';
      },
      (error) => {
        status.textContent = `Error: ${error.message}`;
        clockIn.disabled = true;
        clockOut.disabled = true;
        clockIn.style.opacity = '0.6';
        clockOut.style.opacity = '0.6';
      },
      { enableHighAccuracy: true, maximumAge: 10000 }
    );
  } else {
    status.textContent = 'Geolocation not supported';
    clockIn.disabled = true;
    clockOut.disabled = true;
    clockIn.style.opacity = '0.6';
    clockOut.style.opacity = '0.6';
  }

  async function startVideo() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      video.srcObject = stream;
      video.play();
      video.style.transform = 'scaleX(-1)';
      faceMessage.textContent = 'Please face the camera...';
    } catch (err) {
      console.error('Camera/video error:', err);
      faceMessage.textContent = 'Camera error. Try again.';
      popupHeader.textContent = 'Verification Unsuccessful';
      popupMessage.textContent = `Camera error. Try again. Details: ${err.name} - ${err.message}.`;
      popupFooter.textContent = `${new Date().toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}`;
      popupRetry.innerHTML = '<button onclick="retryCamera()">Retry Camera</button>';
      popup.style.display = 'block';
      clockIn.disabled = false;
      clockOut.disabled = false;
      faceRecognition.style.display = 'none';
      if (video.srcObject) video.srcObject.getTracks().forEach(track => track.stop());
    }
  }

  window.retryCamera = async () => {
    popup.style.display = 'none';
    faceRecognition.style.display = 'block';
    await startVideo();
  };

  async function validateFace(imageData) {
    const apiKey = '4f4766d9-fc3b-436a-b24e-f57851a1c865';
    const url = '/api/proxy/face-recognition';
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: imageData }),
        mode: 'cors',
        credentials: 'omit'
      });
      const result = await response.json();
      console.log('Proxy API Response:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: result
      });
      if (result.result && result.result.length > 0) {
        if (result.result[0].similarity > 0.6) {
          return result.result[0].subject;
        } else {
          console.log('Low similarity:', result.result[0].similarity);
          return { error: 'Low similarity detected' };
        }
      }
      return { error: 'No matching face found' };
    } catch (error) {
      console.error('Face recognition proxy error:', {
        message: error.message,
        name: error.name,
        stack: error.stack,
        url: url,
        apiKeyIncluded: !!apiKey,
        fetchOptions: {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
          mode: 'cors',
          credentials: 'omit'
        }
      });
      return { error: `API error: Failed to fetch - ${error.message}` };
    }
  }

  async function captureAndCompare() {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext('2d');
    context.scale(-1, 1);
    context.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    const imageData = canvas.toDataURL('image/jpeg').split(',')[1];
    const result = await validateFace(imageData);
    return typeof result === 'string' ? { success: true, name: result } : { success: false, error: result.error };
  }

  async function handleClock(action) {
    const status = document.getElementById('status');
    const location = document.getElementById('location');
    const clockIn = document.getElementById('clockIn');
    const clockOut = document.getElementById('clockOut');
    const message = document.getElementById('message');
    const faceRecognition = document.getElementById('faceRecognition');

    const [latStr, lonStr] = location.textContent.replace('Location: ', '').split(', ');
    const latitude = parseFloat(latStr);
    const longitude = parseFloat(lonStr);
    if (isNaN(latitude) || isNaN(longitude)) {
      message.textContent = 'Location not loaded yet. Try again!';
      message.className = 'error';
      return;
    }
    status.textContent = `Processing ${action}...`;
    clockIn.disabled = true;
    clockOut.disabled = true;
    faceRecognition.style.display = 'block';
    await startVideo();

    setTimeout(async () => {
      const faceMessage = document.getElementById('faceMessage');
      if (faceMessage.textContent === 'Camera error. Try again.') return;
      const result = await captureAndCompare();
      if (result.success && result.name) {
        faceRecognition.style.display = 'none';
        const [latStr, lonStr] = location.textContent.replace('Location: ', '').split(', ');
        const latitude = parseFloat(latStr);
        const longitude = parseFloat(lonStr);
        try {
          const response = await fetch('/api/attendance/web', {

            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action,
              latitude,
              longitude,
              timestamp: new Date().toISOString(),
              subjectId: result.name
            })
          });
          const data = await response.json();
          if (data.success) {
            popupHeader.textContent = 'Verification Successful';
            popupMessage.textContent = `Thank you ${result.name}, you have ${action} successfully at ${new Date().toLocaleTimeString()}`;
            popupFooter.textContent = `${new Date().toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}`;
            popup.style.display = 'block';
          } else {
            popupHeader.textContent = 'Verification Unsuccessful';
            popupMessage.textContent = data.message || 'Failed to log attendance. Please try again!';
            popupFooter.textContent = `${new Date().toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}`;
            popupRetry.innerHTML = '<button onclick="retryAttendance()">Retry</button>';
            popup.style.display = 'block';
          }
        } catch (error) {
          popupHeader.textContent = 'Verification Unsuccessful';
          popupMessage.textContent = `Server error: ${error.message}. Please try again!`;
          popupFooter.textContent = `${new Date().toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}`;
          popupRetry.innerHTML = '<button onclick="retryAttendance()">Retry</button>';
          popup.style.display = 'block';
        }
      } else {
        faceRecognition.style.display = 'none';
        popupHeader.textContent = 'Verification Unsuccessful';
        popupMessage.textContent = result.error || 'Facial recognition failed. Please try again!';
        popupFooter.textContent = `${new Date().toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}`;
        popupRetry.innerHTML = '<button onclick="retryAttendance()">Retry</button>';
        popup.style.display = 'block';
      }
      setTimeout(() => {
        popup.style.display = 'none';
        clockIn.disabled = false;
        clockOut.disabled = false;
      }, 5000);
    }, 3000);
  }

  window.retryAttendance = () => {
    popup.style.display = 'none';
    handleClock(popupMessage.textContent.includes('clock in') ? 'clock in' : 'clock out');
  };

  document.getElementById('clockIn').addEventListener('click', () => handleClock('clock in'));
  document.getElementById('clockOut').addEventListener('click', () => handleClock('clock out'));
}

window.onload = startLocationWatch;

window.onunload = () => {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  if (video && video.srcObject) video.srcObject.getTracks().forEach(track => track.stop());
};
