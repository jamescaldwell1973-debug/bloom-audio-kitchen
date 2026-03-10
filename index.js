const express = require('express');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');

const app = express();
app.use(express.json());

// Parse credentials and fix the newline issue for Vercel
const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');

const ttsClient = new TextToSpeechClient({ credentials });

app.post('/api/render', async (req, res) => {
  const { script, speed, pause, isPreview } = req.body;
  
  // Transform the lines into a single SSML string with breaks
  // SSML allows us to literally code the silence into the request
  const lines = script.split('\n').filter(l => l.trim());
  const ssml = `<speak>${lines.join(`<break time="${pause}s"/>`)}</speak>`;

  try {
    const [response] = await ttsClient.synthesizeSpeech({
      input: { ssml: ssml },
      voice: { languageCode: 'en-US', name: 'en-US-Studio-O' },
      audioConfig: { audioEncoding: 'MP3', speakingRate: parseFloat(speed) },
    });

    // Send the audio back as a Base64 string for the sidebar to play
    res.json({ 
      audioUrl: `data:audio/mp3;base64,${response.audioContent.toString('base64')}`,
      message: isPreview ? "Preview ready" : "Master Cooked!" 
    });

  } catch (err) {
    console.error('TTS Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
