import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

export default async function faceRecognition(imageBase64) {
  try {
    const response = await fetch(process.env.COMPRE_FACE_URL, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.COMPRE_FACE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image_base64: imageBase64 }),
    });

    const result = await response.json();
    if (result.result?.[0]?.subjects?.[0]) {
      const match = result.result[0].subjects[0];
      if (match.similarity >= 0.7)
        return { success: true, name: match.subject };
      else
        return { success: false, error: 'Face match too low. Try again.' };
    }
    return { success: false, error: 'No matching face found.' };
  } catch (err) {
    return { success: false, error: `CompreFace error: ${err.message}` };
  }
}
