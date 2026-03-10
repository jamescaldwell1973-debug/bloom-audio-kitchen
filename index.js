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
    
    // MANUAL COMMAND: We build the command from scratch to avoid the 'ffprobe' call
    let command = ffmpeg();

    tempFiles.forEach((file, index) => {
      command.input(file);
      // Insert silence if needed
      if (index < tempFiles.length - 1 && parseFloat(pause) > 0) {
        command.input(`anullsrc=channel_layout=mono:sample_rate=44100:duration=${pause}`).inputFormat('lavfi');
      }
    });

    command
      .complexFilter([
        // This tells ffmpeg to just join the streams without checking their metadata first
        {
          filter: 'concat',
          options: { n: (parseFloat(pause) > 0 ? tempFiles.length * 2 - 1 : tempFiles.length), v: 0, a: 1 },
          out: 'out'
        }
      ])
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
      .save(outputName); // Use .save() instead of .mergeToFile() to stay manual

  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = app;
