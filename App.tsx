
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { 
  SessionStatus, 
  SecurityLevel, 
  TranscriptionItem, 
  AccountInfo, 
  Transaction 
} from './types';
import { 
  SYSTEM_INSTRUCTION, 
  VERIFY_IDENTITY_TOOL, 
  GET_ACCOUNT_SUMMARY_TOOL, 
  TRANSFER_TO_HUMAN_TOOL, 
  REPORT_FRAUD_TOOL,
  MOCK_ACCOUNT
} from './constants';
import { decode, decodeAudioData, createPcmBlob } from './services/audio-helpers';

// Helper for UI icons
const ShieldIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
);
const MicroIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
);
const PhoneIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
);

const App: React.FC = () => {
  // --- State ---
  const [status, setStatus] = useState<SessionStatus>(SessionStatus.IDLE);
  const [securityLevel, setSecurityLevel] = useState<SecurityLevel>(SecurityLevel.UNAUTHENTICATED);
  const [transcriptions, setTranscriptions] = useState<TranscriptionItem[]>([]);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  // --- Refs ---
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const transcriptionBuffer = useRef({ user: '', nexus: '' });
  const analyserRef = useRef<AnalyserNode | null>(null);

  // --- Audio Cleanup ---
  const stopAllAudio = useCallback(() => {
    activeSourcesRef.current.forEach(source => {
      try { source.stop(); } catch(e) {}
    });
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const cleanupSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    stopAllAudio();
    setStatus(SessionStatus.IDLE);
  }, [stopAllAudio]);

  // --- Session Initiation ---
  const startNexusSession = async () => {
    try {
      setStatus(SessionStatus.CONNECTING);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

      // Audio Contexts
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }, // Puck is used for the professional female persona
          },
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{ 
            functionDeclarations: [
              VERIFY_IDENTITY_TOOL, 
              GET_ACCOUNT_SUMMARY_TOOL, 
              TRANSFER_TO_HUMAN_TOOL,
              REPORT_FRAUD_TOOL
            ] 
          }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            console.log('Nexus Live session opened');
            setStatus(SessionStatus.ACTIVE);
            
            // Microphone stream to model
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            // Visualizer node
            const analyser = inputCtx.createAnalyser();
            analyser.fftSize = 256;
            analyserRef.current = analyser;
            source.connect(analyser);

            scriptProcessor.onaudioprocess = (e) => {
              if (isMuted) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // 1. Audio Playback
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              const outCtx = outputAudioContextRef.current!;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);
              const buffer = await decodeAudioData(decode(base64Audio), outCtx, 24000, 1);
              const source = outCtx.createBufferSource();
              source.buffer = buffer;
              source.connect(outCtx.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              activeSourcesRef.current.add(source);
              source.onended = () => activeSourcesRef.current.delete(source);
            }

            // 2. Interruption
            if (message.serverContent?.interrupted) {
              stopAllAudio();
            }

            // 3. Transcriptions
            if (message.serverContent?.inputTranscription) {
              transcriptionBuffer.current.user += message.serverContent.inputTranscription.text;
            }
            if (message.serverContent?.outputTranscription) {
              transcriptionBuffer.current.nexus += message.serverContent.outputTranscription.text;
            }
            if (message.serverContent?.turnComplete) {
              const u = transcriptionBuffer.current.user;
              const n = transcriptionBuffer.current.nexus;
              if (u || n) {
                setTranscriptions(prev => [
                  ...prev, 
                  { sender: 'user', text: u, timestamp: new Date() },
                  { sender: 'nexus', text: n, timestamp: new Date() }
                ]);
              }
              transcriptionBuffer.current = { user: '', nexus: '' };
            }

            // 4. Tool Calls
            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                let toolResult: any = "ok";
                
                if (fc.name === 'verify_identity') {
                  if (fc.args.code === '1234') {
                    setSecurityLevel(SecurityLevel.VERIFIED);
                    toolResult = { status: "SUCCESS", message: "User verified. Access granted." };
                  } else {
                    toolResult = { status: "FAILED", message: "Incorrect PIN." };
                  }
                }

                if (fc.name === 'get_account_summary') {
                  if (securityLevel === SecurityLevel.VERIFIED) {
                    setAccount({
                      owner: MOCK_ACCOUNT.owner,
                      accountNumber: MOCK_ACCOUNT.accountNumber,
                      balance: MOCK_ACCOUNT.balance,
                      currency: MOCK_ACCOUNT.currency,
                      status: MOCK_ACCOUNT.status
                    });
                    setTransactions(MOCK_ACCOUNT.transactions);
                    toolResult = { 
                      balance: MOCK_ACCOUNT.balance, 
                      transactions: MOCK_ACCOUNT.transactions.map((t: any) => `${t.merchant}: $${t.amount}`).join(', ') 
                    };
                  } else {
                    toolResult = { error: "Authentication required before accessing account data." };
                  }
                }

                if (fc.name === 'transfer_to_human') {
                  toolResult = { status: "TRANSFERRING", department: fc.args.department };
                  // Simulate UI change
                  setTimeout(() => alert(`Transferring to ${fc.args.department} Department...`), 1000);
                }

                if (fc.name === 'report_fraud') {
                  setSecurityLevel(SecurityLevel.HIGH_RISK);
                  toolResult = { status: "LOCKED", action: "Fraud report registered. Card locked." };
                }

                sessionPromise.then(session => {
                  session.sendToolResponse({
                    functionResponses: {
                      id: fc.id,
                      name: fc.name,
                      response: { result: toolResult }
                    }
                  });
                });
              }
            }
          },
          onerror: (e) => {
            console.error('Nexus API Error:', e);
            setStatus(SessionStatus.ERROR);
          },
          onclose: () => {
            console.log('Nexus Live session closed');
            setStatus(SessionStatus.IDLE);
          }
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error('Failed to start Nexus session', err);
      setStatus(SessionStatus.ERROR);
    }
  };

  // --- Animation loop for audio level ---
  useEffect(() => {
    let animationId: number;
    const update = () => {
      if (analyserRef.current) {
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setAudioLevel(average);
      }
      animationId = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(animationId);
  }, []);

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-8 space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between glass p-4 rounded-2xl nexus-glow">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-lg flex items-center justify-center">
            <ShieldIcon />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">NEXUS CORE</h1>
            <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold">Financial Concierge AI</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="hidden md:flex flex-col items-end">
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${
              securityLevel === SecurityLevel.VERIFIED ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 
              securityLevel === SecurityLevel.HIGH_RISK ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
              'bg-amber-500/20 text-amber-400 border border-amber-500/30'
            }`}>
              {securityLevel}
            </span>
            <span className="text-[10px] text-slate-500 mono mt-1">SECURE_TUNNEL_0092</span>
          </div>
          <div className="w-2 h-2 rounded-full animate-pulse bg-green-500"></div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">
        {/* Left Column: AI Interface */}
        <div className="lg:col-span-8 flex flex-col space-y-6 overflow-hidden">
          {/* Main Visualizer Area */}
          <div className="flex-1 glass rounded-3xl flex flex-col items-center justify-center p-8 relative overflow-hidden">
            {/* Background elements */}
            <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] border border-blue-500/30 rounded-full animate-ripple"></div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] border border-blue-400/20 rounded-full animate-ripple" style={{animationDelay: '0.5s'}}></div>
            </div>

            {/* AI Voice Pulse */}
            <div className="relative z-10 flex flex-col items-center">
              <div 
                className={`w-32 h-32 md:w-48 md:h-48 rounded-full bg-gradient-to-tr from-blue-600 via-indigo-500 to-cyan-400 flex items-center justify-center transition-all duration-300 shadow-2xl ${
                  status === SessionStatus.ACTIVE ? 'scale-110 shadow-blue-500/40' : 'grayscale opacity-50'
                }`}
                style={{ 
                  transform: status === SessionStatus.ACTIVE ? `scale(${1 + audioLevel / 200})` : 'scale(1)',
                  boxShadow: status === SessionStatus.ACTIVE ? `0 0 ${audioLevel}px rgba(59, 130, 246, 0.6)` : ''
                }}
              >
                <div className="w-28 h-28 md:w-40 md:h-40 rounded-full bg-slate-900 flex items-center justify-center border-4 border-slate-800">
                    {status === SessionStatus.ACTIVE ? (
                        <div className="flex gap-1 items-end h-8">
                            {[1,2,3,4,5].map(i => (
                                <div key={i} className="w-1 bg-blue-400 rounded-full animate-bounce" style={{
                                    height: `${20 + Math.random() * 60}%`,
                                    animationDuration: `${0.4 + Math.random() * 0.4}s`,
                                    animationDelay: `${i * 0.1}s`
                                }}></div>
                            ))}
                        </div>
                    ) : (
                        <MicroIcon />
                    )}
                </div>
              </div>
              
              <div className="mt-8 text-center space-y-2">
                <h2 className="text-2xl font-bold">
                    {status === SessionStatus.IDLE ? 'System Offline' : 
                     status === SessionStatus.CONNECTING ? 'Establishing Secure Link...' : 
                     'Nexus Online'}
                </h2>
                <p className="text-slate-400 max-w-md mx-auto">
                    {status === SessionStatus.IDLE ? 'Tap "Start Session" to connect to your financial concierge via secure voice link.' : 
                     status === SessionStatus.ACTIVE ? 'I am listening. How can I assist you with your finances today?' : 
                     'Authenticating secure handshake...'}
                </p>
                {status === SessionStatus.ACTIVE && (
                  <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 bg-blue-500/10 rounded-full border border-blue-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                    <span className="text-[10px] text-blue-400 uppercase font-bold tracking-widest">Premium Voice: Lagos HQ Active</span>
                  </div>
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 z-20">
                {status === SessionStatus.IDLE || status === SessionStatus.ERROR ? (
                    <button 
                        onClick={startNexusSession}
                        className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 px-10 rounded-full shadow-lg hover:shadow-blue-500/50 transition-all flex items-center gap-3 active:scale-95"
                    >
                        <PhoneIcon />
                        START SECURE SESSION
                    </button>
                ) : (
                    <>
                        <button 
                            onClick={() => setIsMuted(!isMuted)}
                            className={`p-4 rounded-full transition-all border ${
                                isMuted ? 'bg-red-500/20 text-red-500 border-red-500/30' : 'bg-slate-800 text-slate-300 border-slate-700'
                            }`}
                        >
                            <MicroIcon />
                        </button>
                        <button 
                            onClick={cleanupSession}
                            className="bg-red-600 hover:bg-red-500 text-white font-bold py-4 px-10 rounded-full shadow-lg hover:shadow-red-500/50 transition-all flex items-center gap-3 active:scale-95"
                        >
                            <svg className="w-6 h-6 rotate-[135deg]" fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" /></svg>
                            TERMINATE CALL
                        </button>
                    </>
                )}
            </div>
          </div>

          {/* Transcript Log */}
          <div className="h-64 glass rounded-3xl p-6 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Live Transcript</h3>
              <span className="text-[10px] mono text-slate-600">ENCRYPTION: AES-256</span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
              {transcriptions.length === 0 && (
                <div className="h-full flex items-center justify-center text-slate-600 italic text-sm">
                  Conversation logs will appear here during active sessions.
                </div>
              )}
              {transcriptions.map((t, i) => (
                <div key={i} className={`flex ${t.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                        t.sender === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-800 text-slate-300 rounded-tl-none border border-slate-700'
                    }`}>
                        {t.text}
                    </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Account Dashboard */}
        <div className="lg:col-span-4 flex flex-col space-y-6 overflow-hidden">
          {/* Account Balance Card */}
          <div className="glass rounded-3xl p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
                <svg className="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M11.5 2C6.81 2 3 5.81 3 10.5S6.81 19 11.5 19h.5v3l4-4-4-4v3h-.5C7.91 17 5 14.09 5 10.5S7.91 4 11.5 4 18 6.91 18 10.5c0 .59-.08 1.15-.23 1.68l1.51 1.51c.46-.99.72-2.1.72-3.26C20 5.81 16.19 2 11.5 2z" /></svg>
            </div>
            <div className="relative z-10">
                <h3 className="text-slate-400 text-sm font-medium mb-1">Total Available Balance</h3>
                <div className={`text-4xl font-bold mono transition-all duration-700 ${securityLevel === SecurityLevel.VERIFIED ? 'blur-0' : 'blur-md select-none'}`}>
                   ${account?.balance.toLocaleString() || '0,000.00'}
                </div>
                <div className="mt-4 flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-tighter">Nexus Reserve Platinum</span>
                    <span className="text-xs text-blue-400 mono">{account?.accountNumber || '**** **** **** ****'}</span>
                </div>
            </div>
            
            {securityLevel !== SecurityLevel.VERIFIED && (
                <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
                    <div className="w-12 h-12 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center mb-4">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m11-3V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-3z" /></svg>
                    </div>
                    <p className="text-sm font-semibold mb-1">RESTRICTED VIEW</p>
                    <p className="text-xs text-slate-400">Please say "Verify my identity" to authenticate and view your financial data.</p>
                </div>
            )}
          </div>

          {/* Transactions List */}
          <div className="flex-1 glass rounded-3xl p-6 flex flex-col overflow-hidden">
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-4">Recent Activity</h3>
            <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                {transactions.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-4">
                        <div className="w-12 h-12 border-2 border-dashed border-slate-700 rounded-full"></div>
                        <p className="text-sm italic">No active data stream...</p>
                    </div>
                )}
                {transactions.map(tx => (
                    <div key={tx.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-800/40 border border-slate-700/50 hover:bg-slate-800/60 transition-colors">
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${tx.type === 'debit' ? 'bg-slate-700 text-slate-300' : 'bg-green-500/20 text-green-400'}`}>
                                {tx.type === 'debit' ? (
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>
                                ) : (
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                )}
                            </div>
                            <div>
                                <p className="text-sm font-semibold">{tx.merchant}</p>
                                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{tx.category} • {tx.date}</p>
                            </div>
                        </div>
                        <div className={`font-bold mono ${tx.type === 'debit' ? 'text-white' : 'text-green-400'}`}>
                            {tx.type === 'debit' ? '-' : '+'}${tx.amount.toFixed(2)}
                        </div>
                    </div>
                ))}
            </div>
            
            {securityLevel !== SecurityLevel.VERIFIED && transactions.length > 0 && (
                <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 text-center">
                    <p className="text-xs text-slate-400 uppercase tracking-widest font-bold">Authentication Required</p>
                </div>
            )}
          </div>

          {/* Security Banner */}
          <div className={`p-4 rounded-2xl border flex items-center gap-4 ${
            securityLevel === SecurityLevel.HIGH_RISK ? 'bg-red-500/20 border-red-500/30 text-red-400' : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
          }`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                securityLevel === SecurityLevel.HIGH_RISK ? 'bg-red-500 text-white animate-pulse' : 'bg-blue-600 text-white'
            }`}>
                <ShieldIcon />
            </div>
            <div className="flex-1">
                <p className="text-xs font-bold uppercase tracking-tight">Security Status</p>
                <p className="text-[10px] opacity-80 leading-tight">
                    {securityLevel === SecurityLevel.UNAUTHENTICATED ? 'Identity not verified. Limited access mode enabled.' : 
                     securityLevel === SecurityLevel.VERIFIED ? 'Identity verified. Full concierge services active.' : 
                     'FRAUD ALERT: ACCOUNT LOCKDOWN INITIATED. CONTACT SECURITY IMMEDIATELY.'}
                </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer Status Bar */}
      <footer className="glass rounded-xl p-3 flex items-center justify-between text-[10px] mono text-slate-500">
        <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                API VERSION: G2.5-NAT-VOX
            </div>
            <div className="hidden md:block">LATENCY: {status === SessionStatus.ACTIVE ? '42ms' : '--'}</div>
            <div className="hidden md:block">ENCRYPTION: RSA-4096</div>
        </div>
        <div className="flex items-center gap-4">
            <span>© 2024 NEXUS CORE BANKING SOLUTIONS</span>
            <span className="text-blue-500 font-bold">PCI-DSS COMPLIANT</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
