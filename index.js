const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const fs = require('fs');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(express.json());

const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
const ttsClient = new TextToSpeechClient({ credentials });

app.post('/api/render', async (req, res) => {
  const { script, speed, pause, isPreview } = req.body;
  const lines = script.split('\n').filter(l => l.trim());
  const tempFiles = [];

  try {
    // 1. Generate the Speech Lines
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

    // 2. Generate a "Physical" Silence File (No lavfi needed)
    const silenceFile = path.join('/tmp', 'silence.mp3');
    await new Promise((resolve, reject) => {
      // Use the first line as a template to ensure sample rates match
      ffmpeg(tempFiles[0])
        .audioFilters(`apause=d=${pause}`) 
        .outputOptions(['-t', pause, '-f mp3'])
        .on('end', resolve)
        .on('error', reject)
        .save(silenceFile);
    });

    // 3. Assemble the Playlist
    const outputName = path.join('/tmp', `master_${Date.now()}.mp3`);
    let command = ffmpeg();
    
    // Create the order: Line -> Silence -> Line -> Silence
    const playlist = [];
    tempFiles.forEach((file, index) => {
      playlist.push(file);
      if (index < tempFiles.length - 1 && parseFloat(pause) > 0) {
        playlist.push(silenceFile);
      }
    });

    playlist.forEach(f => command.input(f));

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
        // Full Cleanup
        [...tempFiles, silenceFile, outputName].forEach(f => {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        });
      })
      .mergeToFile(outputName, '/tmp'); // Standard merge

  } catch (err) {
    console.error('Final Catch Error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = app;
