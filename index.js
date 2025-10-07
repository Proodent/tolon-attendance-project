const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '/')));

// 🔹 Replace with your actual CompreFace API info
const COMPRE_API_KEY = '4f4766d9-fc3b-436a-b24e-f57851a1c865';
const COMPRE_URL = 'http://server.proodentit.com:8081/application?app=a7e293fd-699c-4736-9af7-4f597bd450da'; // example URL

// 🔹 Home route (serves index.html)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 🔹 API route: Face verification
app.post('/verify-face', async (req, res) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const response = await fetch(COMPRE_URL, {
      method: 'POST',
      headers: {
        'x-api-key': COMPRE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file: image,
      }),
    });

    const data = await response.json();

    if (data.result && data.result.length > 0) {
      const match = data.result[0].subjects?.[0];
      if (match && match.similarity >= 0.9) {
        return res.json({
          success: true,
          name: match.subject,
          similarity: match.similarity,
        });
      }
    }

    res.json({ success: false, message: 'Verification unsuccessful. No matching face found.' });
  } catch (error) {
    console.error('Error verifying face:', error);
    res.status(500).json({ success: false, message: 'Server error during verification.' });
  }
});

// 🔹 Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
