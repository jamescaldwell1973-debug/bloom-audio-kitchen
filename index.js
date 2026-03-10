const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// NOW you can use ffmpeg because it was defined above
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(express.json());

const ttsClient = new TextToSpeechClient();

app.post('/api/render', async (req, res) => {
  const { script, speed, pause, isPreview, tagName } = req.body;
  const lines = script.split('\n').filter(l => l.trim());
  const tempFiles = [];

  try {
    // 1. Generate individual MP3s for each line
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

    // 2. Stitch lines together with silence
    const outputName = path.join('/tmp', `master_${Date.now()}.mp3`);
    let command = ffmpeg();

    tempFiles.forEach((file, index) => {
      command = command.input(file);
      // Add silence input (lavfi) between lines
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
          // Send back to Sidebar for "Tasting"
          res.json({ audioUrl: `data:audio/mp3;base64,${audioBuffer.toString('base64')}` });
        } else {
          // This is where "Make It Happen" saves to Drive
          // For now, returning base64 so you can verify it worked
          res.json({ message: "Master Cooked!", audioUrl: `data:audio/mp3;base64,${audioBuffer.toString('base64')}` });
        }
        
        // Cleanup temp files
        tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
        fs.existsSync(outputName) && fs.unlinkSync(outputName);
      })
      .mergeToFile(outputName);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = app;

