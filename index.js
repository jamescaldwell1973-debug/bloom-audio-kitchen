const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// 1. SETUP: Link FFmpeg binary
ffmpeg.setFfmpegPath(ffmpegPath);

// 2. APP CONFIG
const app = express();
app.use(express.json());

// Parse credentials and fix the newline issue for Vercel
const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');

const ttsClient = new TextToSpeechClient({ credentials });

// 3. THE KITCHEN LOGIC
app.post('/api/render', async (req, res) => {
  const { script, speed, pause, isPreview, tagName } = req.body;
  
  // Clean the script and split into lines
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

    // Stitching Process
    const outputName = path.join('/tmp', `master_${Date.now()}.mp3`);
    let command = ffmpeg();

    tempFiles.forEach((file, index) => {
      command = command.input(file);
      // Inject silence between lines if it's not the last line
      if (index < tempFiles.length - 1) {
        command = command.input('anullsrc=channel_layout=mono:sample_rate=44100')
                         .inputOptions(['-f lavfi', `-t ${pause}`]);
      }
    });

    command
      .on('error', (err) => {
        console.error('FFmpeg Error:', err);
        res.status(500).json({ error: err.message });
      })
      .on('end', () => {
        if (!fs.existsSync(outputName)) {
          return res.status(500).json({ error: "Output file not found" });
        }

        const audioBuffer = fs.readFileSync(outputName);
        const base64Audio = audioBuffer.toString('base64');
        
        res.json({ 
          audioUrl: `data:audio/mp3;base64,${base64Audio}`,
          message: isPreview ? "Preview ready" : "Master Cooked!" 
        });

        // Cleanup: remove temporary files to keep the server light
        tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
        fs.existsSync(outputName) && fs.unlinkSync(outputName);
      })
      .mergeToFile(outputName);

  } catch (err) {
    console.error('Kitchen Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
