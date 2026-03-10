const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// 1. SETUP: Now that 'ffmpeg' and 'ffmpegPath' are defined above, we can link them
ffmpeg.setFfmpegPath(ffmpegPath);

// 2. APP CONFIG
const app = express();
app.use(express.json());

const ttsClient = new TextToSpeechClient();

// 3. THE KITCHEN LOGIC
app.post('/api/render', async (req, res) => {
  const { script, speed, pause, isPreview, tagName } = req.body;
  const lines = script.split('\n').filter(l => l.trim());
  const tempFiles = [];

  try {
    // Generate Audio for each line
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

    // Stitch with FFmpeg
    const outputName = path.join('/tmp', `master_${Date.now()}.mp3`);
    let command = ffmpeg();

    tempFiles.forEach((file, index) => {
      command = command.input(file);
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
      .on('end', async () => {
        const audioBuffer = fs.readFileSync(outputName);
        if (isPreview) {
          res.json({ audioUrl: audioBuffer.toString('base64') });
        } else {
          res.json({ message: "Master Cooked!", audioUrl: audioBuffer.toString('base64') });
        }
        // Cleanup
        tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
        fs.existsSync(outputName) && fs.unlinkSync(outputName);
      })
      .mergeToFile(outputName);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
