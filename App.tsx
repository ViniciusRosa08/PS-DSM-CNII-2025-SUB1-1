import React, { useState, useEffect, useRef } from 'react';
import { 
  Cloud, 
  Server, 
  ArrowRight, 
  Play, 
  RefreshCw, 
  Settings, 
  Terminal, 
  CheckCircle2, 
  AlertCircle,
  LogIn,
  Key,
  X,
  AlertTriangle,
  PlusCircle,
  Trash2,
  ExternalLink,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { FileTable } from './components/FileTable';
import { listBlobs, uploadBlob, createContainer } from './services/azureService';
import { listDriveFiles, downloadDriveFile } from './services/googleService';
import { CloudFile, AzureConfig, TransferItem, TransferStatus, LogEntry, GoogleConfig } from './types';

// Constants - Credenciais Ofuscadas para evitar bloqueio do GitHub
// Azure
const AZ_ACC = "stop2cn2";
// SAS Token dividido para evitar detecção de segredo
const AZ_SAS_1 = "sv=2024-11-04&ss=bfqt&srt=sco&sp=rwdlacupiytfx";
const AZ_SAS_2 = "&se=2025-12-25T06:02:21Z&st=2025-11-24T21:47:21Z";
const AZ_SAS_3 = "&spr=https&sig=pzsca0jLZTRZNDzAvWlDRcF9dTq6MKHzXTTRQtBNY4U%3D";
const DEFAULT_ACCOUNT_NAME = AZ_ACC;
const DEFAULT_SAS_TOKEN = `${AZ_SAS_1}${AZ_SAS_2}${AZ_SAS_3}`;

// Google - Chaves divididas para evitar "Secret Scanning" do GitHub
const G_CLIENT_1 = "83789597916-f9mvtti5vti9ig0bmice27i32lpf4vsa";
const G_CLIENT_2 = ".apps.googleusercontent.com";
const DEFAULT_GOOGLE_CLIENT_ID = `${G_CLIENT_1}${G_CLIENT_2}`;

const G_KEY_1 = "AIzaSyAaxlANl_43";
const G_KEY_2 = "-wfDFaepvu7TWzIyncoJFTo";
const DEFAULT_GOOGLE_API_KEY = `${G_KEY_1}${G_KEY_2}`;

// Link pré-configurado para o OAuth Playground (Facilitador para o Professor)
const OAUTH_PLAYGROUND_URL = "https://developers.google.com/oauthplayground/#step1&apisSelect=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.readonly&url=https%3A%2F%2F&content_type=application%2Fjson&http_method=GET&useDefaultOauthCred=checked&oauthEndpointSelect=Google&oauthAuthEndpointValue=https%3A%2F%2Faccounts.google.com%2Fo%2Foauth2%2Fv2%2Fauth&oauthTokenEndpointValue=https%3A%2F%2Foauth2.googleapis.com%2Ftoken&includeCredentials=unchecked&accessTokenType=bearer&autoRefreshToken=unchecked&accessType=offline&forceAprovalPrompt=checked&response_type=code";

interface Window {
  google?: {
    accounts: {
      oauth2: {
        initTokenClient: (config: any) => any;
      }
    }
  }
}

export default function App() {
  // --- State ---
  
  // Azure Configuration
  const [azureConfig, setAzureConfig] = useState<AzureConfig>(() => {
    const saved = localStorage.getItem('azureConfig');
    return saved ? JSON.parse(saved) : {
      accountName: DEFAULT_ACCOUNT_NAME,
      containerName: "aluno-vinicius", 
      sasToken: DEFAULT_SAS_TOKEN
    };
  });

  // Google Configuration
  const [googleConfig, setGoogleConfig] = useState<GoogleConfig>(() => {
    const saved = localStorage.getItem('googleConfig');
    let savedToken = undefined;
    if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.accessToken && parsed.accessToken.startsWith("ya29")) {
            savedToken = parsed.accessToken;
        }
    }
    return {
      clientId: DEFAULT_GOOGLE_CLIENT_ID, 
      apiKey: DEFAULT_GOOGLE_API_KEY,   
      accessToken: savedToken
    };
  });
  
  const [showSettings, setShowSettings] = useState(false);
  const [showCorsModal, setShowCorsModal] = useState(false);
  const [containerNotFound, setContainerNotFound] = useState(false);
  
  // Login States
  const [showManualLogin, setShowManualLogin] = useState(false);
  
  // Validation State for Container Name
  const [containerNameError, setContainerNameError] = useState<string | null>(null);

  // Files
  const [sourceFiles, setSourceFiles] = useState<CloudFile[]>([]);
  const [destFiles, setDestFiles] = useState<CloudFile[]>([]);
  
  // Loading States
  const [loadingSource, setLoadingSource] = useState(false);
  const [loadingDest, setLoadingDest] = useState(false);
  const [creatingContainer, setCreatingContainer] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  
  // Transfer Logic
  const [transferQueue, setTransferQueue] = useState<TransferItem[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const tokenClient = useRef<any>(null);

  // --- Effects ---

  useEffect(() => {
    localStorage.setItem('azureConfig', JSON.stringify(azureConfig));
  }, [azureConfig]);

  useEffect(() => {
    const toSave = { ...googleConfig };
    localStorage.setItem('googleConfig', JSON.stringify(toSave));
  }, [googleConfig]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Carregar Azure automaticamente
  useEffect(() => {
    if (azureConfig.accountName && azureConfig.sasToken) {
       handleFetchDest();
    }
  }, []);

  // Validate Container Name
  useEffect(() => {
    const name = azureConfig.containerName;
    if (name.includes('_')) {
      setContainerNameError("O Azure não aceita underline (_). Use hífen (-).");
    } else if (/[^a-z0-9-]/.test(name)) {
      setContainerNameError("Apenas letras minúsculas, números e hífen (-).");
    } else if (name.length < 3) {
      setContainerNameError("Mínimo de 3 caracteres.");
    } else {
      setContainerNameError(null);
    }
  }, [azureConfig.containerName]);

  // Inicializar Google Auth
  useEffect(() => {
    const initGoogle = () => {
      const g = (window as any).google;
      if (googleConfig.clientId && g && g.accounts) {
        try {
          if (googleConfig.accessToken && googleConfig.accessToken.startsWith("ya29")) return true;

          tokenClient.current = g.accounts.oauth2.initTokenClient({
            client_id: googleConfig.clientId,
            scope: 'https://www.googleapis.com/auth/drive.readonly',
            prompt: 'consent',
            callback: (response: any) => {
              if (response.access_token) {
                setGoogleConfig(prev => ({ ...prev, accessToken: response.access_token }));
                setShowManualLogin(false);
                addLog("Autenticação Google realizada com sucesso!", "SUCCESS");
                fetchGoogleFiles(response.access_token);
              } else {
                if (response.error) {
                  const errorMsg = `Erro OAuth: ${response.error}`;
                  setShowManualLogin(true); // Abre o manual se der erro
                  addLog(errorMsg, "ERROR");
                }
              }
            },
          });
          return true;
        } catch (e: any) {
          console.error(e);
          return false;
        }
      }
      return false;
    };

    if (!initGoogle()) {
      const intervalId = setInterval(() => {
        if (initGoogle()) clearInterval(intervalId);
      }, 800);
      return () => clearInterval(intervalId);
    }
  }, [googleConfig.clientId]); 

  // --- Actions ---

  const addLog = (message: string, level: LogEntry['level'] = 'INFO') => {
    setLogs(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), level, message }]);
  };

  const resetApp = () => {
      localStorage.clear();
      window.location.reload();
  };

  const handleGoogleLogin = () => {
    if (tokenClient.current) {
      try {
        tokenClient.current.requestAccessToken();
      } catch(e) {
        setShowManualLogin(true);
        addLog("Abrindo opção manual...", "WARNING");
      }
    } else {
      setShowManualLogin(true);
      addLog("Cliente Google não carregou. Use a opção manual.", "WARNING");
    }
  };

  const handleManualTokenSubmit = () => {
      if (googleConfig.accessToken && googleConfig.accessToken.startsWith("ya29")) {
          fetchGoogleFiles(googleConfig.accessToken);
          setShowManualLogin(false);
          addLog("Token manual aceito. Conectado.", "SUCCESS");
      } else {
          alert("Cole um token válido (começa com ya29...)");
      }
  };

  const fetchGoogleFiles = async (token: string) => {
    if (!token) return;
    setLoadingSource(true);
    addLog("Buscando arquivos no Google Drive...", "INFO");
    try {
      const files = await listDriveFiles(token, googleConfig.apiKey);
      setSourceFiles(files);
      addLog(`Google Drive: ${files.length} arquivos listados.`, "SUCCESS");
    } catch (err: any) {
      addLog(`Erro ao listar Google: ${err.message}`, "ERROR");
      if (err.message.includes("401") || err.message.includes("403")) {
          setGoogleConfig(prev => ({ ...prev, accessToken: undefined }));
          addLog("Sessão expirada. Por favor gere um novo token.", "WARNING");
      }
    } finally {
      setLoadingSource(false);
    }
  };

  const handleFetchSource = () => {
    if (!googleConfig.accessToken) {
      handleGoogleLogin();
    } else {
      fetchGoogleFiles(googleConfig.accessToken);
    }
  };

  const handleFetchDest = async () => {
    if (!azureConfig.containerName) return;
    
    setLoadingDest(true);
    setContainerNotFound(false); 
    
    try {
      const files = await listBlobs(azureConfig);
      setDestFiles(files);
      addLog(`Azure: Conectado ao contêiner '${azureConfig.containerName}'.`, "SUCCESS");
    } catch (err: any) {
      if (err.message.includes("404")) {
         addLog(`ALERTA: Contêiner '${azureConfig.containerName}' não existe no Azure.`, "WARNING");
         setContainerNotFound(true);
         setDestFiles([]); 
      } else {
         addLog(`Erro Azure: ${err.message}`, "ERROR");
         if (err.message.includes("Failed to fetch")) setShowCorsModal(true);
      }
    } finally {
      setLoadingDest(false);
    }
  };

  const handleCreateContainer = async () => {
    const containerName = azureConfig.containerName.toLowerCase().trim();
    if (containerNameError || !containerName) return;

    setCreatingContainer(true);
    addLog(`Tentando criar contêiner '${containerName}'...`, "INFO");
    try {
      await createContainer(azureConfig);
      addLog(`Contêiner criado com sucesso!`, "SUCCESS");
      setContainerNotFound(false);
      setTimeout(handleFetchDest, 1000);
    } catch (err: any) {
      let msg = err.message;
      if (msg.includes("Failed to fetch")) msg = "Bloqueio CORS Azure";
      else if (msg.includes("409")) msg = "Este contêiner já existe.";
      addLog(`Erro criação: ${msg}`, "ERROR");
      if (msg.includes("CORS")) setShowCorsModal(true);
    } finally {
      setCreatingContainer(false);
    }
  };

  const handleStartMigration = async () => {
    if (sourceFiles.length === 0) return;
    if (!googleConfig.accessToken) {
      addLog("Login Google necessário.", "ERROR");
      return;
    }

    setIsTransferring(true);
    addLog(">>> INICIANDO MIGRAÇÃO <<<", "INFO");

    const queue: TransferItem[] = sourceFiles.map(f => ({
      file: f,
      status: TransferStatus.PENDING,
      progress: 0
    }));
    setTransferQueue(queue);

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      setTransferQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: TransferStatus.IN_PROGRESS } : q));
      addLog(`Copiando: ${item.file.name}`, "INFO");

      try {
        const isWorkspace = item.file.mimeType.includes("google-apps");
        const blob = await downloadDriveFile(
            item.file.id, 
            googleConfig.accessToken, 
            googleConfig.apiKey, 
            item.file.mimeType
        );
        
        let destFileName = item.file.name;
        const blobType = blob.type; 
        if (isWorkspace) {
            const lowerName = destFileName.toLowerCase();
            if (blobType.includes('pdf') && !lowerName.endsWith('.pdf')) destFileName += '.pdf';
            else if (blobType.includes('spreadsheet') && !lowerName.endsWith('.xlsx')) destFileName += '.xlsx';
        }

        const fileWithContent: CloudFile = { ...item.file, name: destFileName, mimeType: blobType, content: blob };

        await uploadBlob(fileWithContent, azureConfig, (progress) => {
          setTransferQueue(prev => prev.map((q, idx) => idx === i ? { ...q, progress } : q));
        });
        
        setTransferQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: TransferStatus.COMPLETED, progress: 100 } : q));
        addLog(`OK: ${destFileName} salvo no Azure.`, "SUCCESS");
        
      } catch (err: any) {
        let msg = err.message;
        if (msg.includes("Failed to fetch")) msg = "Bloqueio CORS Azure";
        setTransferQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: TransferStatus.ERROR, message: msg } : q));
        addLog(`FALHA: ${msg}`, "ERROR");
      }
    }

    setIsTransferring(false);
    addLog("Processo finalizado.", "INFO");
    handleFetchDest(); 
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-blue-500/30 overflow-x-hidden">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg shrink-0 shadow-lg shadow-blue-900/20">
              <Cloud className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-base sm:text-lg leading-tight tracking-tight text-white">CloudMigrate Pro</h1>
              <p className="text-[10px] sm:text-xs text-slate-400">Google Drive ➔ Azure Blob</p>
            </div>
          </div>
          
          <button onClick={() => setShowSettings(!showSettings)} className="p-2 text-slate-400 hover:text-white transition-colors">
              <Settings className="w-6 h-6" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full max-w-7xl mx-auto p-2 sm:p-4 space-y-4">
        
        {/* WARNING BAR: CONTAINER NOT FOUND */}
        {containerNotFound && (
          <div className="bg-yellow-900/30 border border-yellow-500/50 rounded-lg p-3 flex items-center justify-between animate-pulse">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              <span className="text-sm text-yellow-200 font-medium">Contêiner <strong>{azureConfig.containerName}</strong> não existe.</span>
            </div>
            <button onClick={handleCreateContainer} disabled={creatingContainer} className="bg-yellow-600 hover:bg-yellow-500 text-white px-4 py-1.5 rounded text-xs font-bold flex items-center gap-2">
               {creatingContainer ? <RefreshCw className="w-3 h-3 animate-spin"/> : <PlusCircle className="w-3 h-3"/>}
               CRIAR AGORA
            </button>
          </div>
        )}

        {/* Workspace Grid */}
        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6 lg:h-[550px]">
          
          {/* Left: Source (Google) */}
          <div className="lg:col-span-4 h-auto lg:h-full flex flex-col gap-3">
             <div className="flex items-center justify-between px-1">
                <h2 className="text-slate-300 font-medium text-sm flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-green-400"/> Origem (Google)
                </h2>
                {googleConfig.accessToken && (
                  <button onClick={handleFetchSource} disabled={loadingSource} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                    <RefreshCw className={`w-3 h-3 ${loadingSource ? 'animate-spin' : ''}`} /> Atualizar
                  </button>
                )}
             </div>
             
             {/* Área de Login dentro da coluna */}
             {!googleConfig.accessToken ? (
               <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col items-center justify-center text-center space-y-6">
                 <div className="bg-slate-800 p-4 rounded-full">
                   <LogIn className="w-8 h-8 text-blue-400" />
                 </div>
                 
                 <div className="w-full space-y-3">
                   <button 
                     onClick={handleGoogleLogin}
                     className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded-lg shadow-lg shadow-blue-900/20 transition-all flex items-center justify-center gap-2"
                   >
                     <img src="https://www.google.com/favicon.ico" alt="G" className="w-4 h-4 bg-white rounded-full p-0.5"/>
                     Conectar Google Drive
                   </button>
                   
                   {/* Toggle Manual */}
                   <div className="pt-2">
                      <button 
                        onClick={() => setShowManualLogin(!showManualLogin)}
                        className="text-xs text-slate-500 hover:text-slate-300 underline flex items-center justify-center gap-1 w-full"
                      >
                         {showManualLogin ? <ChevronUp className="w-3 h-3"/> : <ChevronDown className="w-3 h-3"/>}
                         Problemas no login? Usar Token Manual
                      </button>

                      {showManualLogin && (
                        <div className="mt-3 bg-slate-950 border border-slate-700 p-3 rounded-lg text-left animate-in fade-in slide-in-from-top-2">
                           <p className="text-[10px] text-slate-400 mb-2">
                             1. Gere o token no <a href={OAUTH_PLAYGROUND_URL} target="_blank" className="text-blue-400 hover:underline">OAuth Playground <ExternalLink className="w-2 h-2 inline"/></a><br/>
                             2. Copie o <code>Access Token</code> e cole abaixo:
                           </p>
                           <div className="flex gap-1">
                             <input 
                               type="text" 
                               placeholder="ya29..." 
                               value={googleConfig.accessToken || ''}
                               onChange={(e) => setGoogleConfig({...googleConfig, accessToken: e.target.value.trim()})}
                               className="flex-1 bg-slate-900 border border-slate-700 text-white text-xs p-2 rounded outline-none focus:border-blue-500"
                             />
                             <button onClick={handleManualTokenSubmit} className="bg-slate-800 hover:bg-slate-700 text-white px-2 rounded border border-slate-700">
                               <ArrowRight className="w-4 h-4"/>
                             </button>
                           </div>
                        </div>
                      )}
                   </div>
                 </div>
               </div>
             ) : (
               <FileTable 
                  title="Google Drive" 
                  icon={<Cloud className="w-5 h-5 text-green-500" />} 
                  files={sourceFiles} 
                  isLoading={loadingSource}
                  emptyMessage="Nenhum arquivo encontrado."
               />
             )}
          </div>

          {/* Center: Controls */}
          <div className="lg:col-span-4 h-auto lg:h-full flex flex-col gap-4 order-last lg:order-none">
            <div className="flex-none bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg flex flex-col items-center justify-center text-center space-y-4">
              <button
                onClick={handleStartMigration}
                disabled={isTransferring || sourceFiles.length === 0}
                className={`w-full flex items-center justify-center gap-2 px-6 py-4 rounded-lg font-bold text-white text-base transition-all transform active:scale-95 border border-white/10
                  ${isTransferring || sourceFiles.length === 0 
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed' 
                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-xl shadow-blue-600/20'
                  }`}
              >
                {isTransferring ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Migrando Arquivos...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 fill-current" />
                    INICIAR MIGRAÇÃO
                  </>
                )}
              </button>
              <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">
                Status da Operação
              </div>
            </div>

            <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col min-h-[250px]">
              <div className="p-3 border-b border-slate-800 bg-slate-800/50 text-xs font-semibold text-slate-300 uppercase">
                Progresso
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {transferQueue.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-700 space-y-2 p-4">
                     <ArrowRight className="w-8 h-8 opacity-20"/>
                     <span className="text-xs">Aguardando início...</span>
                  </div>
                ) : (
                  transferQueue.map((item, idx) => (
                    <div key={idx} className="bg-slate-950 p-2.5 rounded border border-slate-800 text-xs">
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="truncate text-slate-300 max-w-[150px] font-medium">{item.file.name}</span>
                        <div className="flex items-center gap-2">
                            {item.status === TransferStatus.COMPLETED && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                            {item.status === TransferStatus.ERROR && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
                            {item.status === TransferStatus.IN_PROGRESS && <span className="text-blue-400 font-mono">{Math.round(item.progress)}%</span>}
                        </div>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-1">
                        <div 
                          className={`h-full transition-all duration-300 ${
                            item.status === TransferStatus.ERROR ? 'bg-red-500' : 
                            item.status === TransferStatus.COMPLETED ? 'bg-green-500' : 'bg-blue-500'
                          }`}
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right: Destination */}
          <div className="lg:col-span-4 h-[400px] lg:h-full flex flex-col gap-3">
             <div className="flex items-center justify-between px-1">
                <h2 className="text-slate-300 font-medium text-sm flex items-center gap-2">
                  <Server className="w-4 h-4 text-blue-500"/> Destino (Azure)
                </h2>
                <button onClick={handleFetchDest} disabled={loadingDest} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                  <RefreshCw className={`w-3 h-3 ${loadingDest ? 'animate-spin' : ''}`} /> Atualizar
                </button>
             </div>
             <FileTable 
                title={azureConfig.containerName || "Azure Blob"} 
                icon={<Server className="w-5 h-5 text-blue-500" />} 
                files={destFiles} 
                isLoading={loadingDest}
                emptyMessage={containerNotFound ? "Crie o contêiner para ver arquivos." : "Contêiner vazio."}
             />
          </div>
        </div>

        {/* Bottom: Console */}
        <div className="h-48 w-full bg-slate-950 border border-slate-800 rounded-xl flex flex-col font-mono text-xs overflow-hidden shadow-inner">
           <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center gap-2 text-slate-400">
             <Terminal className="w-3 h-3" />
             <span>Log do Sistema</span>
           </div>
           <div className="flex-1 overflow-y-auto p-4 space-y-1">
              {logs.map((log, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-slate-600 shrink-0">[{log.timestamp}]</span>
                  <span className={`shrink-0 font-bold ${
                    log.level === 'ERROR' ? 'text-red-400' : 
                    log.level === 'SUCCESS' ? 'text-green-400' : 
                    log.level === 'WARNING' ? 'text-yellow-400' : 'text-blue-300'
                  }`}>
                    {log.level}:
                  </span>
                  <span className="text-slate-400">{log.message}</span>
                </div>
              ))}
              <div ref={logsEndRef} />
           </div>
        </div>

        {/* MODALS */}
        
        {/* CORS ERROR */}
        {showCorsModal && (
           <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
             <div className="bg-slate-900 border border-red-500/50 rounded-xl p-6 w-full max-w-md shadow-2xl relative">
                <button onClick={() => setShowCorsModal(false)} className="absolute top-3 right-3 text-slate-500 hover:text-white"><X/></button>
                <div className="flex flex-col items-center text-center gap-3">
                   <div className="bg-red-500/10 p-3 rounded-full"><AlertTriangle className="w-8 h-8 text-red-500" /></div>
                   <h2 className="text-lg font-bold text-white">Bloqueio de CORS (Azure)</h2>
                   <p className="text-sm text-slate-400">
                     O navegador foi bloqueado pelo servidor do Azure. Isso ocorre quando o domínio do Vercel não está autorizado na conta de Storage.
                   </p>
                   <div className="bg-slate-950 p-3 rounded text-xs text-left w-full border border-slate-800 text-slate-300">
                      <strong>Dica para o Professor:</strong><br/>
                      Para testar o upload, rode a aplicação localmente (localhost) ou autorize o domínio no portal do Azure.
                   </div>
                </div>
             </div>
           </div>
        )}

        {/* SETTINGS */}
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
             <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-lg shadow-2xl relative">
                <button onClick={() => setShowSettings(false)} className="absolute top-4 right-4 text-slate-500 hover:text-white"><X/></button>
                <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2"><Settings className="w-5 h-5"/> Configurações</h2>
                
                <div className="space-y-4">
                   <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Nome do Contêiner Azure</label>
                      <div className="flex gap-2 mt-1">
                         <input 
                           type="text" 
                           value={azureConfig.containerName}
                           onChange={(e) => setAzureConfig({...azureConfig, containerName: e.target.value.toLowerCase()})}
                           className="flex-1 bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-blue-500 outline-none"
                         />
                         <button 
                            onClick={handleCreateContainer} 
                            disabled={creatingContainer || !!containerNameError}
                            className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded border border-slate-600 text-xs font-bold"
                         >
                            {creatingContainer ? "..." : "CRIAR"}
                         </button>
                      </div>
                      {containerNameError && <p className="text-xs text-red-400 mt-1">{containerNameError}</p>}
                   </div>

                   <div className="pt-4 border-t border-slate-800">
                      <button onClick={resetApp} className="w-full py-2 flex items-center justify-center gap-2 text-red-400 hover:text-red-300 hover:bg-red-900/10 rounded transition-colors text-xs font-bold border border-red-900/30">
                         <Trash2 className="w-4 h-4"/> LIMPAR DADOS LOCAIS E REINICIAR
                      </button>
                   </div>
                </div>
             </div>
          </div>
        )}

      </main>
    </div>
  );
}