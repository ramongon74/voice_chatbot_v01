
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality } from '@google/genai';

// --- TYPE DEFINITIONS ---
interface Message {
  id: number;
  text: string;
  sender: 'user' | 'bot';
}

interface Language {
  code: string;
  name: string;
}

type Status = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING' | 'ERROR';


// --- CONSTANTS ---
const LANGUAGES: Language[] = [
  { code: 'en-US', name: 'English' },
  { code: 'es-ES', name: 'Español' },
  { code: 'fr-FR', name: 'Français' },
  { code: 'de-DE', name: 'Deutsch' },
  { code: 'zh-CN', name: '中文' },
];

const API_KEY = process.env.API_KEY;

// --- AUDIO UTILITIES ---
const decode = (base64: string): Uint8Array => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const encode = (bytes: Uint8Array): string => {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const decodeAudioData = async (
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> => {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
};


// --- HELPER UI COMPONENTS ---
const MessageBubble: React.FC<{ message: Message }> = ({ message }) => (
  <div className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
    <div
      className={`max-w-xs md:max-w-md lg:max-w-lg px-4 py-2 rounded-2xl ${
        message.sender === 'user'
          ? 'bg-blue-500 text-white rounded-br-none'
          : 'bg-gray-200 text-gray-800 rounded-bl-none'
      }`}
    >
      {message.text}
    </div>
  </div>
);

const StatusIndicator: React.FC<{ status: Status }> = ({ status }) => {
  const statusInfo = {
    IDLE: { text: 'Click the mic to talk', color: 'text-gray-500' },
    LISTENING: { text: 'Listening...', color: 'text-blue-500' },
    THINKING: { text: 'Thinking...', color: 'text-yellow-500 animate-pulse' },
    SPEAKING: { text: 'Speaking...', color: 'text-green-500' },
    ERROR: { text: 'An error occurred. Please try again.', color: 'text-red-500' },
  };
  return <p className={`text-sm text-center ${statusInfo[status].color}`}>{statusInfo[status].text}</p>;
};

const LanguageSelector: React.FC<{ selectedLanguage: Language; onSelect: (lang: Language) => void; disabled: boolean }> = ({ selectedLanguage, onSelect, disabled }) => (
    <div className="relative">
        <select
            value={selectedLanguage.code}
            onChange={(e) => onSelect(LANGUAGES.find(l => l.code === e.target.value)!)}
            disabled={disabled}
            className="appearance-none bg-gray-100 border border-gray-300 rounded-md py-1 px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
            {LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.name}</option>)}
        </select>
    </div>
);


// --- MAIN APP COMPONENT ---
const App: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ id: 0, text: "Hello! How can I help you today?", sender: 'bot'}]);
  const [status, setStatus] = useState<Status>('IDLE');
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(LANGUAGES[0]);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [inputText, setInputText] = useState('');

  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const playingSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');
  const messageEndRef = useRef<HTMLDivElement>(null);
  
  if (!API_KEY) {
      return (
        <div className="flex items-center justify-center h-screen bg-red-100 text-red-800">
            <p className="text-lg font-semibold">API_KEY environment variable not set. Please provide a valid Gemini API key.</p>
        </div>
      )
  }

  const scrollToBottom = () => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  const addMessage = (text: string, sender: 'user' | 'bot') => {
    if (!text.trim()) return;
    setMessages(prev => [...prev, { id: Date.now(), text: text.trim(), sender }]);
  };

  const stopAllPlayback = useCallback(() => {
    playingSourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Ignore errors if source already stopped
      }
    });
    playingSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const stopSession = useCallback(async () => {
    stopAllPlayback();

    if (sessionPromiseRef.current) {
      const session = await sessionPromiseRef.current;
      session.close();
      sessionPromiseRef.current = null;
    }
    
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;

    scriptProcessorRef.current?.disconnect();
    scriptProcessorRef.current = null;
    
    outputAudioContextRef.current?.close();
    outputAudioContextRef.current = null;

    setStatus('IDLE');
    setIsVoiceMode(false);
  }, [stopAllPlayback]);

  const startSession = useCallback(async () => {
    setStatus('LISTENING');
    setIsVoiceMode(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ai = new GoogleGenAI({ apiKey: API_KEY });
      
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      
      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          systemInstruction: `You are a helpful and friendly chatbot. You must respond in ${selectedLanguage.name}. Your answers should be concise and conversational.`,
        },
        callbacks: {
          onopen: () => {
            const source = inputAudioContext.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = {
                data: encode(new Uint8Array(new Int16Array(inputData.map(f => f * 32768)).buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              sessionPromiseRef.current?.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContext.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent) {
              if(status !== 'SPEAKING') setStatus('THINKING');

              const { inputTranscription, outputTranscription, modelTurn, interrupted, turnComplete } = message.serverContent;
              
              if(inputTranscription?.text) {
                currentInputTranscriptionRef.current += inputTranscription.text;
              }

              if (outputTranscription?.text) {
                currentOutputTranscriptionRef.current += outputTranscription.text;
              }

              if (modelTurn?.parts[0]?.inlineData?.data) {
                setStatus('SPEAKING');
                const base64Audio = modelTurn.parts[0].inlineData.data;
                const audioContext = outputAudioContextRef.current;
                if (audioContext) {
                    const audioBuffer = await decodeAudioData(decode(base64Audio), audioContext, 24000, 1);
                    const source = audioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(audioContext.destination);
                    
                    const startTime = Math.max(nextStartTimeRef.current, audioContext.currentTime);
                    source.start(startTime);
                    nextStartTimeRef.current = startTime + audioBuffer.duration;
                    
                    playingSourcesRef.current.add(source);
                    source.onended = () => {
                      playingSourcesRef.current.delete(source);
                      if (playingSourcesRef.current.size === 0) {
                         setStatus('LISTENING');
                      }
                    };
                }
              }

              if (interrupted) {
                stopAllPlayback();
                setStatus('LISTENING');
              }
              
              if (turnComplete) {
                const finalUserInput = currentInputTranscriptionRef.current;
                const finalBotOutput = currentOutputTranscriptionRef.current;
                
                addMessage(finalUserInput, 'user');
                addMessage(finalBotOutput, 'bot');
                
                currentInputTranscriptionRef.current = '';
                currentOutputTranscriptionRef.current = '';
              }
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error(e);
            setStatus('ERROR');
            stopSession();
          },
          onclose: () => {
            // Session closed by server.
          },
        },
      });
    } catch (error) {
      console.error('Failed to start session:', error);
      setStatus('ERROR');
      setIsVoiceMode(false);
    }
  }, [selectedLanguage, stopAllPlayback]);

  useEffect(() => {
      return () => {
          stopSession();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleVoiceMode = () => {
    if (isVoiceMode) {
      stopSession();
    } else {
      startSession();
    }
  };

  const handleSendText = async () => {
    if (!inputText.trim()) return;
    const textToSend = inputText;
    addMessage(textToSend, 'user');
    setInputText('');
    setStatus('THINKING');
    
    try {
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: textToSend,
        config: {
          systemInstruction: `You are a helpful and friendly chatbot. You must respond in ${selectedLanguage.name}. Your answers should be concise and conversational.`
        }
      });
      addMessage(response.text, 'bot');
    } catch(error) {
      console.error("Text generation failed", error);
      addMessage("Sorry, I encountered an error.", 'bot');
      setStatus('ERROR');
    } finally {
      setStatus('IDLE');
    }
  };


  return (
    <div className="fixed bottom-5 right-5 z-50">
      {isOpen ? (
        <div className="w-[calc(100vw-40px)] h-[calc(100vh-100px)] sm:w-[380px] sm:h-[600px] bg-white rounded-2xl shadow-2xl flex flex-col transition-all duration-300 ease-in-out">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-800">Gemini Chat</h2>
            <div className="flex items-center gap-2">
              <LanguageSelector selectedLanguage={selectedLanguage} onSelect={setSelectedLanguage} disabled={isVoiceMode}/>
              <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>
            </div>
          </div>
          
          {/* Messages */}
          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
            <div ref={messageEndRef} />
          </div>

          {/* Input & Controls */}
          <div className="p-4 border-t border-gray-200">
            {isVoiceMode && <div className="mb-2"><StatusIndicator status={status} /></div>}
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                placeholder="Type a message..."
                className="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isVoiceMode}
              />
              <button
                onClick={handleToggleVoiceMode}
                className={`p-3 rounded-full transition-colors duration-200 ${isVoiceMode ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-14 0m7 10v-10m0 0a2 2 0 00-2-2h-1a2 2 0 00-2 2v2a2 2 0 002 2h1a2 2 0 002-2v-2z" /></svg>
              </button>
              <button
                 onClick={handleSendText}
                 disabled={isVoiceMode || !inputText}
                 className="p-3 bg-green-500 text-white rounded-full hover:bg-green-600 disabled:bg-gray-300"
              >
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14M12 5l7 7-7 7" /></svg>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-blue-600 text-white p-4 rounded-full shadow-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-transform duration-200 hover:scale-110"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.948 8.948 0 01-4.13-1.095l-.398.398a1 1 0 01-1.414 0l-1.095-1.095a1 1 0 010-1.414l.398-.398A8.948 8.948 0 012 10c0-4.418 3.582-8 8-8s8 3.582 8 8zm-8 4a4 4 0 100-8 4 4 0 000 8zm0-2a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
        </button>
      )}
    </div>
  );
};

export default App;
