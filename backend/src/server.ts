import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, LiveSession, Modality, LiveServerMessage } from '@google/genai';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error('API_KEY environment variable not set.');
}

// Handle HTTP requests for text chat
app.post('/api/chat/text', async (req, res) => {
  try {
    const { message, language } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: message,
      config: {
        systemInstruction: `You are a helpful and friendly chatbot. You must respond in ${language || 'English'}. Your answers should be concise and conversational.`
      }
    });

    res.json({ reply: response.text });
  } catch (error) {
    console.error('Text chat error:', error);
    res.status(500).json({ error: 'Failed to get response from Gemini' });
  }
});


// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
    if (request.url === '/api/chat/voice') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});


// Handle WebSocket connections for voice chat
wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected for voice chat');

  let sessionPromise: Promise<LiveSession> | null = null;
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  ws.on('message', async (message: string) => {
    const parsedMessage = JSON.parse(message);

    if (parsedMessage.type === 'config' && !sessionPromise) {
        const language = parsedMessage.language || 'English';
        
        sessionPromise = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            config: {
                responseModalities: [Modality.AUDIO],
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
                },
                systemInstruction: `You are a helpful and friendly chatbot. You must respond in ${language}. Your answers should be concise and conversational.`,
            },
            callbacks: {
                onopen: () => console.log('Gemini session opened.'),
                onmessage: (msg: LiveServerMessage) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'gemini_response', data: msg }));
                    }
                },
                onerror: (e: ErrorEvent) => {
                    console.error('Gemini error:', e);
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'error', data: 'Gemini session error.' }));
                    }
                    ws.close();
                },
                onclose: () => {
                    console.log('Gemini session closed.');
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.close();
                    }
                },
            },
        });
    } else if (parsedMessage.type === 'audio_in' && sessionPromise) {
        try {
            const session = await sessionPromise;
            session.sendRealtimeInput({ 
                media: {
                    data: parsedMessage.data,
                    mimeType: 'audio/pcm;rate=16000',
                } 
            });
        } catch (error) {
            console.error('Failed to send audio to Gemini:', error);
        }
    }
  });

  ws.on('close', async () => {
    console.log('Client disconnected');
    if (sessionPromise) {
      try {
        const session = await sessionPromise;
        session.close();
      } catch(e) {
        console.error("Error closing gemini session", e)
      }
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
