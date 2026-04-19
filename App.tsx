/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { 
  Plus,
  Trash2,
  Edit3,
  Check,
  Send, 
  Settings, 
  Mic, 
  X, 
  Target, 
  ArrowUp, 
  RotateCcw,
  Sparkles,
  User,
  Bot,
  MessageSquare,
  ImageIcon,
  Code2,
  BrainCircuit,
  Menu,
  LogOut,
  LogIn,
  AlertCircle,
  Bell,
  CheckCircle2,
  Info,
  Paperclip,
  FileText,
  Video,
  File,
  Download,
  Share2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { 
  onAuthStateChanged, 
  User as FirebaseUser,
  signInWithPopup,
  signOut,
  googleProvider,
  auth,
  db,
  storage,
  ref,
  uploadBytes,
  getDownloadURL
} from './firebase';
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot, 
  serverTimestamp, 
  doc, 
  setDoc, 
  getDoc,
  getDocFromServer,
  Timestamp,
  deleteDoc,
  updateDoc,
  getDocs,
  writeBatch
} from 'firebase/firestore';

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Error Boundary ---
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "An unexpected error occurred.";
      try {
        const parsed = JSON.parse(this.state.error?.message || "");
        if (parsed.error) errorMessage = parsed.error;
      } catch {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-black flex items-center justify-center p-6 text-center">
          <div className="max-w-md w-full bg-zinc-900 border border-red-900/50 rounded-2xl p-8 space-y-6">
            <div className="w-16 h-16 bg-red-900/20 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="text-red-500" size={32} />
            </div>
            <h1 className="text-2xl font-bold text-white">System Failure</h1>
            <p className="text-zinc-400 text-sm leading-relaxed">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-colors"
            >
              Restart System
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

type Mode = 'chat' | 'image' | 'code' | 'pro';

interface Thread {
  id: string;
  title: string;
  lastMessage?: string;
  updatedAt?: any;
  createdAt?: any;
}

interface Message {
  id: string;
  role: 'user' | 'ai';
  text: string;
  mode?: Mode;
  image?: string;
  attachments?: { url: string; name: string; type: string }[];
  isError?: boolean;
  createdAt?: any;
}

interface Attachment {
  file: File;
  preview?: string;
}

const DEFAULT_BG = "#000000";
const DEFAULT_ACCENT = "#1ed18a";

const MODES: { id: Mode; name: string; icon: any; desc: string; model: string; system: string }[] = [
  { 
    id: 'chat', 
    name: 'General Chat', 
    icon: MessageSquare, 
    desc: 'Fast, everyday assistant', 
    model: 'gemini-3.1-flash-lite-preview',
    system: 'You are Worp AI, a highly advanced assistant with Deep Context Memory. Remember everything discussed in this thread across all turns. When the user switches topics, acknowledge the new topic while keeping the previous ones in active memory. Do NOT mix unrelated topics into a confusing blend; only connect them when requested. Always prioritize providing financial data, prices, and measurements in the local currency and units associated with the user\'s detected locale even if not explicitly asked. [LOCALE_INSTRUCTION]'
  },
  { 
    id: 'image', 
    name: 'Creative Image', 
    icon: ImageIcon, 
    desc: 'Visual generation mode', 
    model: 'gemini-1.5-flash',
    system: 'You are an AI specialized in image analysis and generation. Maintain a historical context of all images discussed in this thread. [LOCALE_INSTRUCTION]'
  },
  { 
    id: 'code', 
    name: 'Code Expert', 
    icon: Code2, 
    desc: 'Programming & Logic', 
    model: 'gemini-3-flash-preview',
    system: 'You are a master software engineer. Use thread history to remember previous code snippets, bugs, and architectural decisions. [LOCALE_INSTRUCTION]'
  },
  { 
    id: 'pro', 
    name: 'Pro Reasoning', 
    icon: BrainCircuit, 
    desc: 'Complex problem solving', 
    model: 'gemini-3.1-pro-preview',
    system: 'Professional problem solver. Maintain a long-term logical chain of thought across the entire thread. [LOCALE_INSTRUCTION]'
  }
];

interface NotificationItem {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
  timestamp: Date;
}

export default function App() {
  return (
    <ErrorBoundary>
      <WorpApp />
    </ErrorBoundary>
  );
}

function WorpApp() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [localeInfo, setLocaleInfo] = useState({ locale: 'en-US', timeZone: 'UTC' });
  const messagesRef = useRef<Message[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    try {
      setLocaleInfo({
        locale: navigator.language || 'en-US',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      });
    } catch (e) {
      console.error("Locale detection failed", e);
    }
  }, []);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [threadTitleInput, setThreadTitleInput] = useState('');
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [activeMode, setActiveMode] = useState<Mode>('chat');
  const [hasLoggedInBefore, setHasLoggedInBefore] = useState(() => {
    return localStorage.getItem('hasLoggedInBefore') === 'true';
  });
  const [bgColor, setBgColor] = useState(DEFAULT_BG);
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);
  const [selectedModel, setSelectedModel] = useState('gemini-3.1-flash-lite-preview');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  const recognitionRef = useRef<any>(null);

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      addNotification('Speech recognition is not supported in this browser.', 'error');
      return;
    }

    if (!recognitionRef.current) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setInput(transcript);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        if (event.error === 'not-allowed') {
          addNotification('Microphone access denied. Please open the app in a new tab to grant permission.', 'error');
        } else {
          addNotification(`Speech error: ${event.error}`, 'error');
        }
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }

      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.error('Error starting recognition:', e);
      }
    };
  
    const stopListening = () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        setIsListening(false);
      }
    };

  const sendSystemNotification = async (title: string, body: string) => {
    if (!("Notification" in window)) return;
    
    if (Notification.permission === "granted") {
      try {
        // Try using Service Worker first for better background support
        const registration = await navigator.serviceWorker.ready;
        if (registration && registration.showNotification) {
          await registration.showNotification(title, {
            body,
            icon: '/favicon.svg',
            badge: '/favicon.svg',
            tag: 'worp-ai-notification'
          });
          return;
        }

        // Fallback to standard Notification API
        const notification = new Notification(title, { 
          body, 
          icon: '/favicon.svg',
          badge: '/favicon.svg',
          tag: 'worp-ai-notification'
        });

        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      } catch (e) {
        console.error("Notification error:", e);
      }
    }
  };

  const addNotification = (message: string, type: 'info' | 'success' | 'error' = 'info', system = false) => {
    const id = Math.random().toString(36).substring(7);
    const newNotification: NotificationItem = {
      id,
      message,
      type,
      timestamp: new Date()
    };
    setNotifications(prev => [newNotification, ...prev].slice(0, 5));
    
    // Auto-remove after 4 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 4000);

    // Trigger system notification if requested or if app is in background
    if (system || document.visibilityState === 'hidden') {
      const title = type === 'success' ? 'Worp AI: Success' : 
                    type === 'error' ? 'Worp AI: Error' : 'Worp AI';
      sendSystemNotification(title, message);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- PWA Installation Logic ---
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      addNotification('Worp AI installed successfully!', 'success', true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Worp AI',
          text: 'Check out Worp AI - A dynamic AI companion!',
          url: window.location.origin
        });
        addNotification('Shared successfully!', 'success');
      } else {
        await navigator.clipboard.writeText(window.location.origin);
        addNotification('Link copied to clipboard!', 'info');
      }
    } catch (error) {
      console.log('Error sharing', error);
    }
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      console.log('User accepted the install prompt');
    }
    setDeferredPrompt(null);
  };

  // --- Prevent accidental close during processing ---
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isLoading) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isLoading]);

  // --- Auth & Connection Test ---
  useEffect(() => {
    // Request notification permission
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);

      if (currentUser) {
        if (!hasLoggedInBefore) {
          addNotification(`Welcome to Worp AI, ${currentUser.displayName}!`, 'success');
          localStorage.setItem('hasLoggedInBefore', 'true');
          setHasLoggedInBefore(true);
        } else {
          addNotification(`Welcome back, ${currentUser.displayName}!`, 'info');
        }

        // Test connection
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (error) {
          if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Please check your Firebase configuration.");
          }
        }

        // Load user settings
        try {
          const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            if (data.theme) {
              if (data.theme.bg) setBgColor(data.theme.bg);
              if (data.theme.accent) setAccentColor(data.theme.accent);
            }
          } else {
            // Create user profile
            const path = `users/${currentUser.uid}`;
            try {
              await setDoc(doc(db, 'users', currentUser.uid), {
                uid: currentUser.uid,
                email: currentUser.email,
                displayName: currentUser.displayName,
                photoURL: currentUser.photoURL,
                createdAt: serverTimestamp(),
                theme: { bg: DEFAULT_BG, accent: DEFAULT_ACCENT }
              });
            } catch (error) {
              handleFirestoreError(error, OperationType.WRITE, path);
            }
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${currentUser.uid}`);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // --- Threads Sync ---
  useEffect(() => {
    if (!user || !isAuthReady) {
      setThreads([]);
      return;
    }

    const path = `users/${user.uid}/threads`;
    const q = query(collection(db, path), orderBy('updatedAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const threadList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Thread[];
      setThreads(threadList);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  // --- Real-time Chat Sync ---
  useEffect(() => {
    if (!isAuthReady) return;

    if (!user) {
      setMessages([{
        id: 'welcome',
        role: 'ai',
        text: "I'm Worp AI. You can chat with me right now! (Note: Sign in to save your chat history and access all features.)"
      }]);
      return;
    }

    if (!activeThreadId) {
      setMessages([{
        id: 'welcome',
        role: 'ai',
        text: `Welcome back, ${user.displayName || 'User'}. Start a new chat or select one from the sidebar.`
      }]);
      return;
    }

    const path = `users/${user.uid}/threads/${activeThreadId}/messages`;
    const q = query(collection(db, path), orderBy('createdAt', 'asc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Message[];
      setMessages(msgs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => unsubscribe();
  }, [user, isAuthReady, activeThreadId]);

  useEffect(() => {
    document.documentElement.style.setProperty('--main-bg', bgColor);
    document.documentElement.style.setProperty('--accent-color', accentColor);
    document.documentElement.style.setProperty('--glass-border', `${accentColor}33`);
  }, [bgColor, accentColor]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      addNotification('Logging in with Google...', 'info');
      setHasLoggedInBefore(true);
      localStorage.setItem('hasLoggedInBefore', 'true');
    } catch (error) {
      console.error("Login Error:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      addNotification('Logged out successfully', 'info');
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newAttachments: Attachment[] = files.map(file => ({
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
    }));
    setAttachments(prev => [...prev, ...newAttachments]);
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => {
      const updated = [...prev];
      if (updated[index].preview) URL.revokeObjectURL(updated[index].preview!);
      updated.splice(index, 1);
      return updated;
    });
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = error => reject(error);
    });
  };

  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;

    const currentInput = input.trim();
    const currentAttachments = [...attachments];
    setInput('');
    setAttachments([]);
    setIsLoading(true);

    let threadId = activeThreadId;

    try {
      let uploadedAttachments: { url: string; name: string; type: string }[] = [];

      if (user) {
        // 1. Create thread if none active
        if (!threadId) {
          const threadsPath = `users/${user.uid}/threads`;
          try {
            const threadRef = await addDoc(collection(db, threadsPath), {
              userId: user.uid,
              title: currentInput.slice(0, 30) || "New Chat",
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
            threadId = threadRef.id;
            setActiveThreadId(threadId);
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, threadsPath);
          }
        }

        const messagesPath = `users/${user.uid}/threads/${threadId}/messages`;

        // 2. Upload attachments to Firebase Storage
        uploadedAttachments = await Promise.all(currentAttachments.map(async (att) => {
          try {
            const storageRef = ref(storage, `users/${user.uid}/attachments/${Date.now()}_${att.file.name}`);
            await uploadBytes(storageRef, att.file);
            const url = await getDownloadURL(storageRef);
            addNotification(`File "${att.file.name}" uploaded successfully!`, 'success', true);
            return {
              url,
              name: att.file.name,
              type: att.file.type
            };
          } catch (error) {
            console.error("Upload error:", error);
            addNotification(`Failed to upload "${att.file.name}"`, 'error');
            throw error;
          }
        }));

        // 3. Save user message to Firestore
        try {
          await addDoc(collection(db, messagesPath), {
            userId: user.uid,
            role: 'user',
            text: currentInput || (uploadedAttachments.length > 0 ? `Attached ${uploadedAttachments.length} file(s)` : ""),
            attachments: uploadedAttachments,
            mode: activeMode,
            createdAt: serverTimestamp()
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, messagesPath);
          addNotification('Failed to send message', 'error');
        }

        // Update thread last message and timestamp
        const threadDocPath = `users/${user.uid}/threads/${threadId}`;
        try {
          await updateDoc(doc(db, `users/${user.uid}/threads`, threadId), {
            lastMessage: currentInput || "Sent an attachment",
            updatedAt: serverTimestamp()
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, threadDocPath);
        }
      }

      const localUserMsg: Message = {
        id: Date.now().toString(),
        role: 'user',
        text: currentInput || (currentAttachments.length > 0 ? `Attached ${currentAttachments.length} file(s)` : ""),
        attachments: user ? [] : currentAttachments.map(att => ({
          url: att.preview || "",
          name: att.file.name,
          type: att.file.type
        })),
        createdAt: new Date()
      };

      if (!user) {
        setMessages(prev => [...prev, localUserMsg]);
      }

      // 4. Call Gemini
      let apiKey = (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "").trim();
      if (apiKey === "AI Studio Free Tier" || apiKey === "undefined" || apiKey === "") {
        apiKey = "";
      }

      if (!apiKey) throw new Error("API Key missing. Please ensure GEMINI_API_KEY is set in the environment.");

      const ai = new GoogleGenAI({ apiKey });
      const modeConfig = MODES.find(m => m.id === activeMode)!;
      
      const isImageRequest = activeMode === 'image' || /generate|draw|create|make|paint|show me an image|picture of/i.test(currentInput);
      
      if (isImageRequest && !currentAttachments.length) {
        const response = await ai.models.generateContent({
          model: 'gemini-1.5-flash',
          contents: [{ role: 'user', parts: [{ text: `Generate a base64 encoded PNG image for: ${currentInput}. Strictly return ONLY a valid base64 JSON field.` }] }],
        });

        let imageUrl = "";
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            imageUrl = `data:image/png;base64,${part.inlineData.data}`;
            break;
          }
        }

        if (user && threadId) {
          const messagesPath = `users/${user.uid}/threads/${threadId}/messages`;
          try {
            await addDoc(collection(db, messagesPath), {
              userId: user.uid,
              role: 'ai',
              text: "Visual data synthesized.",
              image: imageUrl,
              mode: activeMode,
              createdAt: serverTimestamp()
            });
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, messagesPath);
          }
        } else {
          const localAiMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: 'ai',
            text: "Visual data synthesized.",
            image: imageUrl,
            createdAt: new Date()
          };
          setMessages(prev => [...prev, localAiMsg]);
        }
      } else {
        // Multimodal support with history
        // Use a deeper history window and ensure the current prompt is included via Ref for immediate sync
        const fullHistory = [...messagesRef.current, localUserMsg];
        const history = fullHistory.slice(-30).map(msg => ({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.text }]
        })).filter(h => h.parts[0].text); // Filter out empty messages

        const parts: any[] = [{ text: currentInput || "Analyze the attached files." }];
        
        // Add attachments as inlineData for Gemini
        for (const att of currentAttachments) {
          if (att.file.type.startsWith('image/') || att.file.type.startsWith('video/') || att.file.type === 'application/pdf') {
            const base64 = await fileToBase64(att.file);
            parts.push({
              inlineData: {
                data: base64,
                mimeType: att.file.type
              }
            });
          }
        }

        const modelId = activeMode === 'chat' ? selectedModel : modeConfig.model;
        // Map pseudo-models to actual ones if needed
        const actualModel = modelId
          .replace('gemini-3.1-flash-lite-preview', 'gemini-1.5-flash-lite')
          .replace('gemini-3-flash-preview', 'gemini-1.5-flash')
          .replace('gemini-3.1-pro-preview', 'gemini-1.5-pro');

        const locale = navigator.language || 'en-US';
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        let currency = 'USD';
        try {
          // Attempt to get currency from locale - requires a hacky approach since resolvedOptions().currency is often empty
          const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
          const parts = formatter.formatToParts(1);
          const currencyPart = parts.find(p => p.type === 'currency');
          // This doesn't actually give the *local* currency unless we know the local currency code
          // But we can tell the AI the locale and let it deduce the currency.
        } catch (e) {}

        const localeInstruction = `The user is browsing from locale "${locale}" and timezone "${timeZone}". ALWAYS prioritize providing financial data, prices, and measurements in the local currency and units associated with this region (e.g., if locale is en-IN, use INR/₹; if en-GB, use GBP/£), even if the user does not explicitly request it. Integrate this context naturally into your responses. When users ask about products, shopping, or buying items, use Google Search to find real, current products with photos and direct purchase links. Present them as clear shopping cards/sections in your markdown.`;
        const customizedSystem = modeConfig.system.replace('[LOCALE_INSTRUCTION]', localeInstruction);

        const result = await ai.models.generateContentStream({ 
          model: actualModel,
          contents: [...history, { role: 'user', parts }],
          config: {
            systemInstruction: customizedSystem,
            maxOutputTokens: 8192,
            temperature: 0.9,
            tools: ['chat', 'pro'].includes(activeMode) ? [{ googleSearch: {} }] : [],
          }
        });

        let fullText = "";
        const aiMsgId = (Date.now() + 1).toString();
        
        // Initial empty message for streaming
        const initialAiMsg: Message = {
          id: aiMsgId,
          role: 'ai',
          text: "",
          mode: activeMode,
          createdAt: new Date()
        };
        setMessages(prev => [...prev, initialAiMsg]);

        for await (const chunk of result) {
          const chunkText = chunk.text;
          fullText += chunkText;
          setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, text: fullText } : m));
        }

        addNotification('Worp AI synthesis complete.', 'info', true);

        if (user && threadId) {
          const messagesPath = `users/${user.uid}/threads/${threadId}/messages`;
          try {
            await addDoc(collection(db, messagesPath), {
              userId: user.uid,
              role: 'ai',
              text: fullText || "No response received.",
              mode: activeMode,
              createdAt: serverTimestamp()
            });
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, messagesPath);
          }
        }
      }
    } catch (error: any) {
      console.error("AI Error:", error);
      let errorMsg = error.message || "Something went wrong.";
      
      if (user && threadId) {
        await addDoc(collection(db, `users/${user.uid}/threads/${threadId}/messages`), {
          userId: user.uid,
          role: 'ai',
          text: `ERROR: ${errorMsg}`,
          isError: true,
          mode: activeMode,
          createdAt: serverTimestamp()
        }).catch(e => handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}/threads/${threadId}/messages`));
      } else {
        const localErrorMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'ai',
          text: `ERROR: ${errorMsg}`,
          isError: true,
          createdAt: new Date()
        };
        setMessages(prev => [...prev, localErrorMsg]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const startNewChat = () => {
    setActiveThreadId(null);
    setMessages([]);
  };

  const deleteThread = async (id: string) => {
    if (!user) return;
    try {
      const threadPath = `users/${user.uid}/threads/${id}`;
      const messagesPath = `${threadPath}/messages`;
      
      // Delete messages subcollection first
      const messagesSnapshot = await getDocs(collection(db, messagesPath));
      const batch = writeBatch(db);
      messagesSnapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();

      // Delete thread doc
      await deleteDoc(doc(db, `users/${user.uid}/threads`, id));
      addNotification('Thread deleted', 'success');
      
      if (activeThreadId === id) {
        startNewChat();
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/threads/${id}`);
    }
  };

  const renameThread = async (id: string, newTitle: string) => {
    if (!user || !newTitle.trim()) return;
    try {
      await updateDoc(doc(db, `users/${user.uid}/threads`, id), {
        title: newTitle
      });
      addNotification('Thread renamed', 'success');
      setEditingThreadId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/threads/${id}`);
    }
  };

  const updateTheme = async (newBg: string, newAccent: string) => {
    setBgColor(newBg);
    setAccentColor(newAccent);
    if (user) {
      try {
        await setDoc(doc(db, 'users', user.uid), {
          theme: { bg: newBg, accent: newAccent }
        }, { merge: true });
        addNotification('Theme updated successfully!', 'success');
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
        addNotification('Failed to update theme', 'error');
      }
    }
  };

  const resetTheme = () => {
    updateTheme(DEFAULT_BG, DEFAULT_ACCENT);
  };

  return (
    <div 
      className="min-h-screen flex transition-colors duration-300 overflow-x-hidden"
      style={{ backgroundColor: bgColor, color: '#ffffff', fontFamily: "'Inter', sans-serif" }}
    >
      {/* Background Atmosphere */}
      <div 
        className="fixed inset-0 pointer-events-none opacity-20"
        style={{
          background: `radial-gradient(circle at 50% 30%, ${accentColor} 0%, transparent 60%),
                       radial-gradient(circle at 10% 80%, ${accentColor} 0%, transparent 50%)`,
          filter: 'blur(100px)'
        }}
      />

      {/* Sidebar */}
      <motion.div 
        initial={false}
        animate={{ width: isSidebarOpen ? '280px' : '0px', opacity: isSidebarOpen ? 1 : 0 }}
        className="relative h-screen border-r border-white/5 bg-black/40 backdrop-blur-xl z-40 overflow-hidden flex flex-col"
      >
        <div className="p-6 flex items-center gap-3 border-b border-white/5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center relative overflow-hidden shadow-lg" style={{ backgroundColor: accentColor }}>
            <Sparkles size={20} className="text-white drop-shadow-sm" />
          </div>
          <span className="font-bold tracking-tighter text-lg">WORP AI</span>
        </div>

        <div className="px-4 mb-4">
          <button 
            onClick={startNewChat}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-sm font-bold"
          >
            <Plus size={18} />
            New Chat
          </button>
        </div>

        <div className="flex-1 p-4 space-y-6 overflow-y-auto scrollbar-thin">
          {user && threads.length > 0 && (
            <div>
              <label className="text-[10px] uppercase tracking-widest font-bold text-slate-500 px-2 mb-2 block">Recent Chats</label>
              <div className="space-y-1">
                <AnimatePresence mode="popLayout">
                  {threads.map((thread) => (
                    <motion.div 
                      key={thread.id} 
                      layout
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20, scale: 0.95 }}
                      className="group relative"
                    >
                      <button
                        onClick={() => {
                          setActiveThreadId(thread.id);
                        }}
                        className={`w-full flex flex-col gap-1 p-3 rounded-xl transition-all text-left ${
                          activeThreadId === thread.id 
                            ? 'bg-white/10 text-white' 
                            : 'text-slate-500 hover:bg-white/5 hover:text-slate-300'
                        }`}
                      >
                        {editingThreadId === thread.id ? (
                          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                            <input 
                              autoFocus
                              value={threadTitleInput}
                              onChange={e => setThreadTitleInput(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && renameThread(thread.id, threadTitleInput)}
                              className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs w-full outline-none"
                            />
                            <button onClick={() => renameThread(thread.id, threadTitleInput)} className="text-emerald-400">
                              <Check size={14} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="text-xs font-bold truncate pr-6">{thread.title}</div>
                            <div className="text-[10px] opacity-40 truncate">{thread.lastMessage || 'No messages yet'}</div>
                          </>
                        )}
                      </button>
                      {editingThreadId !== thread.id && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingThreadId(thread.id);
                              setThreadTitleInput(thread.title);
                            }}
                            className="p-1 hover:text-white text-slate-600"
                          >
                            <Edit3 size={12} />
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteThread(thread.id);
                            }}
                            className="p-1 hover:text-red-400 text-slate-600"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          <div>
            <label className="text-[10px] uppercase tracking-widest font-bold text-slate-500 px-2 mb-2 block">Intelligence Modes</label>
            <div className="space-y-1">
              {MODES.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => {
                    setActiveMode(mode.id);
                  }}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all group ${
                    activeMode === mode.id 
                      ? 'bg-white/10 text-white' 
                      : 'text-slate-500 hover:bg-white/5 hover:text-slate-300'
                  }`}
                >
                  <mode.icon size={18} style={{ color: activeMode === mode.id ? accentColor : undefined }} />
                  <div className="text-left">
                    <div className="text-sm font-bold">{mode.name}</div>
                    <div className="text-[10px] opacity-60">{mode.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-white/5 space-y-2">
          {user ? (
            <button 
              onClick={handleLogout}
              className="w-full flex items-center gap-3 p-3 rounded-xl text-red-400 hover:bg-red-400/10 transition-all"
            >
              <LogOut size={18} />
              <span className="text-sm font-bold">Sign Out</span>
            </button>
          ) : (
            <button 
              onClick={handleLogin}
              className="w-full flex items-center gap-3 p-3 rounded-xl text-emerald-400 hover:bg-emerald-400/10 transition-all"
            >
              <LogIn size={18} />
              <span className="text-sm font-bold">{hasLoggedInBefore ? 'Sign In' : 'Log In'}</span>
            </button>
          )}
          <button 
            onClick={() => {
              setIsSettingsOpen(true);
            }}
            className="w-full flex items-center gap-3 p-3 rounded-xl text-slate-500 hover:bg-white/5 hover:text-white transition-all"
          >
            <Settings size={18} />
            <span className="text-sm font-bold">System Settings</span>
          </button>
        </div>
      </motion.div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col relative h-screen">
        {/* Header */}
        <header className="h-16 border-b border-white/5 flex items-center justify-between px-6 backdrop-blur-md bg-black/20 z-30">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 text-slate-500 hover:text-white transition-colors"
            >
              <Menu size={20} />
            </button>
            <AnimatePresence>
              {!isSidebarOpen && (
                <motion.div 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex items-center gap-2 mr-4"
                >
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: accentColor }}>
                    <Sparkles size={16} className="text-white" />
                  </div>
                  <span className="font-bold tracking-tighter text-sm hidden sm:block">WORP AI</span>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Active Mode:</span>
              <span className="text-xs font-bold uppercase tracking-widest" style={{ color: accentColor }}>
                {MODES.find(m => m.id === activeMode)?.name}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-3 mr-4">
                <div className="text-right hidden sm:block">
                  <div className="text-[10px] font-bold text-white uppercase tracking-tighter">{user.displayName}</div>
                </div>
                <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-lg border border-white/10" />
              </div>
            )}
            <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10">
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: accentColor }} />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">System Online</span>
            </div>

            {/* Notifications Bell */}
            <div className="relative">
              <button 
                onClick={() => setShowNotifications(!showNotifications)}
                className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-all relative"
              >
                <Bell size={16} className={notifications.length > 0 ? "text-white" : "text-slate-500"} />
                {notifications.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-red-500" />
                )}
              </button>

              <AnimatePresence>
                {showNotifications && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 mt-2 w-64 bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden"
                  >
                    <div className="p-3 border-b border-white/5 flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Notifications</span>
                      {notifications.length > 0 && (
                        <button 
                          onClick={() => {
                            setNotifications([]);
                            addNotification('All notifications cleared', 'info');
                          }}
                          className="text-[8px] uppercase tracking-widest text-slate-500 hover:text-white"
                        >
                          Clear All
                        </button>
                      )}
                    </div>
                    <div className="max-h-64 overflow-y-auto scrollbar-thin">
                      {notifications.length === 0 ? (
                        <div className="p-6 text-center">
                          <Bell size={24} className="mx-auto text-slate-700 mb-2 opacity-20" />
                          <p className="text-[10px] text-slate-500 uppercase tracking-widest">No new notifications</p>
                        </div>
                      ) : (
                        notifications.map(notif => (
                          <div key={notif.id} className="p-3 border-b border-white/5 hover:bg-white/5 transition-all">
                            <div className="flex items-start gap-2">
                              {notif.type === 'success' ? (
                                <CheckCircle2 size={12} className="text-emerald-500 mt-0.5" />
                              ) : notif.type === 'error' ? (
                                <AlertCircle size={12} className="text-red-500 mt-0.5" />
                              ) : (
                                <Info size={12} className="text-blue-500 mt-0.5" />
                              )}
                              <div className="flex-1">
                                <p className="text-[10px] text-white leading-relaxed">{notif.message}</p>
                                <p className="text-[8px] text-slate-500 mt-1">{notif.timestamp.toLocaleTimeString()}</p>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-10 space-y-8 scrollbar-thin">
          <div className="max-w-4xl mx-auto space-y-8">
            <AnimatePresence mode="popLayout">
              {messages.map((msg, idx) => (
                <motion.div
                  key={msg.id}
                  layout
                  initial={{ opacity: 0, x: msg.role === 'user' ? 20 : -20, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9, y: 10 }}
                  transition={{ 
                    type: "spring", 
                    damping: 20, 
                    stiffness: 150
                  }}
                  className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  <motion.div 
                    animate={msg.role === 'ai' ? { 
                      boxShadow: [`0 0 0px ${accentColor}00`, `0 0 15px ${accentColor}33`, `0 0 0px ${accentColor}00`] 
                    } : {}}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-1 ${
                      msg.role === 'user' ? 'bg-white/10' : ''
                    }`}
                    style={msg.role === 'ai' ? { backgroundColor: `${accentColor}22`, color: accentColor, border: `1px solid ${accentColor}44` } : {}}
                  >
                    {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                  </motion.div>
                  <div 
                    className={`max-w-[85%] p-4 rounded-2xl backdrop-blur-md border transition-all duration-500 ${
                      msg.role === 'user' 
                        ? 'bg-white/5 border-white/10' 
                        : 'bg-black/40'
                    }`}
                    style={msg.role === 'ai' ? { 
                      borderColor: `${accentColor}33`,
                      boxShadow: idx === messages.length - 1 && msg.role === 'ai' ? `0 0 30px ${accentColor}11` : 'none'
                    } : {}}
                  >
                    {msg.role === 'ai' && (
                      <div className="text-[10px] uppercase tracking-widest font-bold mb-2 opacity-50" style={{ color: accentColor }}>
                        {MODES.find(m => m.id === activeMode)?.name}
                      </div>
                    )}
                    <div className={`prose prose-invert max-w-none text-sm leading-relaxed overflow-x-hidden break-words ${msg.isError ? 'text-red-400' : 'text-slate-200'}`}>
                      <ReactMarkdown 
                        components={{
                          img: ({node, ...props}) => (
                            <img 
                              {...props} 
                              referrerPolicy="no-referrer" 
                              className="rounded-xl border border-white/10 my-4 shadow-xl max-h-[400px] object-contain bg-white/5" 
                            />
                          )
                        }}
                      >
                        {msg.text}
                      </ReactMarkdown>
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {msg.attachments.map((att, i) => (
                            <a 
                              key={i} 
                              href={att.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all group"
                            >
                              <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-slate-400 group-hover:text-white transition-colors">
                                {att.type.startsWith('image/') ? <ImageIcon size={20} /> : 
                                 att.type.startsWith('video/') ? <Video size={20} /> : 
                                 att.type.includes('pdf') ? <FileText size={20} /> : <File size={20} />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-bold truncate">{att.name}</div>
                                <div className="text-[10px] text-slate-500 uppercase tracking-widest">{att.type.split('/')[1]}</div>
                              </div>
                            </a>
                          ))}
                        </div>
                      )}
                      {msg.image && (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="mt-4 rounded-xl overflow-hidden border border-white/10 shadow-2xl"
                        >
                          <img 
                            src={msg.image} 
                            alt="Generated content" 
                            className="w-full h-auto object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </motion.div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {isLoading && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-4"
              >
                <div 
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${accentColor}22`, color: accentColor, border: `1px solid ${accentColor}44` }}
                >
                  <Sparkles size={16} className="animate-spin" style={{ animationDuration: '3s' }} />
                </div>
                <div className="bg-black/40 border border-white/5 p-4 rounded-2xl flex gap-1 items-center">
                  <motion.span animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
                  <motion.span animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
                  <motion.span animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
                </div>
              </motion.div>
            )}
            <div ref={chatEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="p-6 md:p-10 pt-0">
          <div className="max-w-4xl mx-auto space-y-4">
            {/* Attachment Previews */}
            <AnimatePresence>
              {attachments.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="flex flex-wrap gap-3 p-4 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-md"
                >
                  {attachments.map((att, i) => (
                    <motion.div 
                      key={i}
                      initial={{ scale: 0.8 }}
                      animate={{ scale: 1 }}
                      className="relative group"
                    >
                      <div className="w-20 h-20 rounded-xl overflow-hidden border border-white/10 bg-black/40 flex items-center justify-center">
                        {att.preview ? (
                          <img src={att.preview} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="flex flex-col items-center gap-1 text-slate-500">
                            {att.file.type.startsWith('video/') ? <Video size={24} /> : <FileText size={24} />}
                            <span className="text-[8px] uppercase font-bold truncate max-w-[60px]">{att.file.name}</span>
                          </div>
                        )}
                      </div>
                      <button 
                        onClick={() => removeAttachment(i)}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={14} />
                      </button>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="relative group">
              <div 
                className="absolute -inset-0.5 rounded-2xl blur opacity-20 group-focus-within:opacity-40 transition duration-500"
                style={{ backgroundColor: accentColor }}
              />
              <div className="relative flex items-center gap-3 bg-[#080808] border border-white/10 rounded-2xl px-4 py-2 shadow-2xl">
                <input 
                  type="file" 
                  multiple 
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button 
                  onClick={() => {
                    fileInputRef.current?.click();
                  }}
                  className="p-2 text-slate-500 hover:text-white transition-colors"
                >
                  <Paperclip size={20} />
                </button>
                <button 
                  onClick={isListening ? stopListening : startListening}
                  className={`p-2 transition-all duration-300 rounded-lg ${
                    isListening 
                      ? 'bg-red-500/20 text-red-500 animate-pulse' 
                      : 'text-slate-500 hover:text-white hover:bg-white/5'
                  }`}
                  title={isListening ? "Stop Listening" : "Start Voice Input"}
                >
                  <Mic size={20} className={isListening ? 'scale-110' : ''} />
                </button>
                <textarea 
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={activeMode === 'image' ? "Describe the image you want..." : "Analyze or create anything..."} 
                  className="flex-1 bg-transparent border-none outline-none py-3 text-white placeholder-slate-700 text-lg resize-none min-h-[48px] max-h-[200px] scrollbar-thin overflow-y-auto"
                  rows={1}
                />
                <motion.button 
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleSend}
                  disabled={isLoading || (!input.trim() && attachments.length === 0)}
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-50 disabled:grayscale"
                  style={{ backgroundColor: accentColor }}
                >
                  <ArrowUp size={20} className="text-black font-bold" />
                </motion.button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Panel */}
      <AnimatePresence>
        {isSettingsOpen && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 w-80 h-full z-50 p-10 border-l border-white/5 shadow-2xl"
            style={{ backgroundColor: '#0a0a0a' }}
          >
            <div className="flex justify-between items-center mb-10">
              <h2 className="text-xl font-bold tracking-tight">Style Console</h2>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-500 hover:text-white transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-8">
              {/* Model Selection */}
              <div className="space-y-4">
                <label className="text-[10px] uppercase tracking-widest font-bold text-slate-500">AI Intelligence Level</label>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    { id: 'gemini-3.1-flash-lite-preview', name: 'Flash Lite', desc: 'Highest Volume (Best for limits)' },
                    { id: 'gemini-3-flash-preview', name: 'Flash 3.0', desc: 'Fast & Balanced' },
                    { id: 'gemini-3.1-pro-preview', name: 'Pro 3.1', desc: 'Smartest (Lowest limits)' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedModel(m.id)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        selectedModel === m.id 
                          ? 'bg-white/10 border-white/20' 
                          : 'bg-transparent border-white/5 hover:border-white/10'
                      }`}
                    >
                      <div className="font-bold text-sm" style={{ color: selectedModel === m.id ? accentColor : 'white' }}>
                        {m.name}
                      </div>
                      <div className="text-[10px] text-slate-500">{m.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-px bg-white/5 my-2" />

              <div className="flex flex-col gap-3">
                <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Base Environment</label>
                <input 
                  type="color" 
                  value={bgColor}
                  onChange={(e) => updateTheme(e.target.value, accentColor)}
                  className="w-full h-12 rounded-lg cursor-pointer bg-transparent border-none"
                />
              </div>
              <div className="flex flex-col gap-3">
                <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Accent Matrix</label>
                <input 
                  type="color" 
                  value={accentColor}
                  onChange={(e) => updateTheme(bgColor, e.target.value)}
                  className="w-full h-12 rounded-lg cursor-pointer bg-transparent border-none"
                />
              </div>
              <button 
                onClick={resetTheme}
                className="w-full py-3 bg-white/5 border border-white/10 rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-white/10 transition-all flex items-center justify-center gap-2"
              >
                <RotateCcw size={14} />
                Factory Reset
              </button>

              <div className="h-px bg-white/5 my-2" />

              {/* Notification Settings */}
              <div className="space-y-4">
                <label className="text-[10px] uppercase tracking-widest font-bold text-slate-500">System Notifications</label>
                <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-300">Permission Status</span>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                      Notification.permission === 'granted' ? 'bg-emerald-500/20 text-emerald-500' :
                      Notification.permission === 'denied' ? 'bg-red-500/20 text-red-500' :
                      'bg-blue-500/20 text-blue-500'
                    }`}>
                      {Notification.permission}
                    </span>
                  </div>
                  
                  {Notification.permission !== 'granted' && (
                    <button 
                      onClick={() => Notification.requestPermission()}
                      className="w-full py-2 bg-white/10 hover:bg-white/20 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all"
                    >
                      Request Permission
                    </button>
                  )}

                  <button 
                    onClick={() => {
                      addNotification('This is a test notification from Worp AI!', 'success', true);
                    }}
                    className="w-full py-2 border border-white/10 hover:bg-white/5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                  >
                    <Bell size={12} />
                    Test System Alert
                  </button>
                  <p className="text-[9px] text-slate-600 leading-tight">
                    System notifications allow Worp to alert you even when the app is minimized. 
                    <br/><br/>
                    <strong className="text-emerald-500">Note:</strong> If you are using Worp within a restricted preview, you must <strong>open the app in a new tab</strong> for full system notification support.
                  </p>
                </div>
              </div>

              <div className="h-px bg-white/5 my-2" />

              {/* App Installation */}
              <div className="space-y-4">
                <label className="text-[10px] uppercase tracking-widest font-bold text-slate-500">Device Integration</label>
                <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-300">App Status</span>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                      isInstalled ? 'bg-emerald-500/20 text-emerald-500' : 'bg-blue-500/20 text-blue-500'
                    }`}>
                      {isInstalled ? 'Installed' : 'Web View'}
                    </span>
                  </div>
                  
                  {!isInstalled && deferredPrompt && (
                    <button 
                      onClick={handleInstallClick}
                      className="w-full py-3 bg-emerald-500 text-black hover:bg-emerald-400 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                    >
                      <Download size={14} />
                      Add to Main Screen
                    </button>
                  )}

                  <button 
                    onClick={handleShare}
                    className="w-full py-3 border border-white/10 hover:bg-white/5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                  >
                    <Share2 size={14} />
                    Share Worp
                  </button>
                  
                  <p className="text-[9px] text-slate-600 leading-tight">
                    Install Worp as an app to access it directly from your home screen or taskbar like a native application.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scanline Overlay */}
      <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden opacity-[0.03]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />
        <motion.div 
          animate={{ y: ['0%', '100%'] }} 
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 w-full h-20 bg-gradient-to-b from-transparent via-white/10 to-transparent"
        />
      </div>

      {/* Notifications Toast Overlay */}
      <div className="fixed top-20 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {notifications.map(notif => (
            <motion.div
              key={notif.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.9 }}
              className="p-3 rounded-xl bg-black/60 backdrop-blur-xl border border-white/10 shadow-2xl flex items-center gap-3 min-w-[200px] pointer-events-auto"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                notif.type === 'success' ? 'bg-emerald-500/20 text-emerald-500' :
                notif.type === 'error' ? 'bg-red-500/20 text-red-500' :
                'bg-blue-500/20 text-blue-500'
              }`}>
                {notif.type === 'success' ? <CheckCircle2 size={16} /> :
                 notif.type === 'error' ? <AlertCircle size={16} /> :
                 <Info size={16} />}
              </div>
              <div className="flex-1">
                <p className="text-[11px] text-slate-300 leading-tight">{notif.message}</p>
              </div>
              <button 
                onClick={() => setNotifications(prev => prev.filter(n => n.id !== notif.id))}
                className="p-1 hover:bg-white/10 rounded-md transition-all text-slate-500 hover:text-white"
              >
                <X size={12} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Floating Logo in Corner */}
      <div className="fixed bottom-6 right-6 z-50 pointer-events-none opacity-20 hover:opacity-100 transition-opacity flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center shadow-lg" style={{ backgroundColor: accentColor }}>
          <Sparkles size={12} className="text-white" />
        </div>
        <span className="text-[10px] font-bold tracking-widest uppercase text-white/40">Worp AI</span>
      </div>

      <style>{`
        .scrollbar-thin::-webkit-scrollbar {
          width: 4px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: transparent;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: ${accentColor}44;
          border-radius: 10px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: ${accentColor}66;
        }
        
        .prose pre {
          background: #0a0a0a !important;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px;
          padding: 1.5rem;
          margin: 1rem 0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.8rem;
          position: relative;
          overflow-x: auto;
        }
        
        .prose code {
          color: ${accentColor};
          background: rgba(255,255,255,0.05);
          padding: 0.2rem 0.4rem;
          border-radius: 4px;
          font-size: 0.85em;
        }

        .prose pre code {
          background: transparent;
          padding: 0;
          color: #e2e8f0;
        }

        .prose strong {
          color: ${accentColor};
          font-weight: 700;
        }
      `}</style>
    </div>
  );
}
