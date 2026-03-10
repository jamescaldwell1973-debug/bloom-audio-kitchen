const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const fs = require('fs');
const path = require('path');

// 1. SETUP: Only link the main FFmpeg binary
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(express.json());

// Parse credentials and fix the newline issue
const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
const ttsClient = new TextToSpeechClient({ credentials });

// 3. THE KITCHEN LOGIC
app.post('/api/render', async (req, res) => {
  const { script, speed, pause, isPreview } = req.body;
  const lines = script.split('\n').filter(l => l.trim());
  const tempFiles = [];

  try {
    // Generate individual Audio for each line
    for (let i = 0; i < lines.length; i++) {
      const [response] = await ttsClient.synthesizeSpeech({
        input: { text: lines[i] },
        voice: { languageCode: 'en-US', name: 'en-US-Studio-O' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: parseFloat(speed) },
      });
      
      const fileName = path.join('/tmp', `line_${i}.mp3`);
      fs.writeFileSync(fileName, response.audioContent, 'binary');
      tempFiles.push(fileName);
    }

    const outputName = path.join('/tmp', `master_${Date.now()}.mp3`);
    let command = ffmpeg();

    tempFiles.forEach((file, index) => {
      command = command.input(file);
      if (index < tempFiles.length - 1 && parseFloat(pause) > 0) {
        // Simple silence injection that doesn't require ffprobe
        command = command.input('anullsrc=cl=mono:r=44100')
                         .inputOptions(['-f lavfi', `-t ${pause}`]);
      }
    });

    command
      .on('error', (err) => {
        console.error('FFmpeg Error:', err);
        if (!res.headersSent) res.status(500).json({ error: err.message });
      })
      .on('end', () => {
        const audioBuffer = fs.readFileSync(outputName);
        res.json({ 
          audioUrl: `data:audio/mp3;base64,${audioBuffer.toString('base64')}`,
          message: isPreview ? "Preview ready" : "Master Cooked!" 
        });

        // Cleanup
        tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
        if (fs.existsSync(outputName)) fs.unlinkSync(outputName);
      })
      .mergeToFile(outputName);

  } catch (err) {
    console.error('Kitchen Error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = app;
