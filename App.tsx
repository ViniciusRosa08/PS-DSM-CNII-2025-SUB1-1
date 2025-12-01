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
  BrainCircuit,
  LogIn,
  Info,
  ExternalLink,
  Copy
} from 'lucide-react';
import { FileTable } from './components/FileTable';
import { listBlobs, uploadBlob } from './services/azureService';
import { listDriveFiles, downloadDriveFile } from './services/googleService';
import { analyzeMigrationLogs } from './services/geminiService';
import { CloudFile, AzureConfig, TransferItem, TransferStatus, LogEntry, GoogleConfig } from './types';

// Constants - Credenciais fornecidas pelo usuário
const DEFAULT_ACCOUNT_NAME = "stop2cn2";
// O SAS Token é extraído da BlobSASURL fornecida (tudo após o '?')
const DEFAULT_SAS_TOKEN = "sv=2024-11-04&ss=bfqt&srt=sco&sp=rwdlacupiytfx&se=2025-12-25T06:02:21Z&st=2025-11-24T21:47:21Z&spr=https&sig=pzsca0jLZTRZNDzAvWlDRcF9dTq6MKHzXTTRQtBNY4U%3D";
const DEFAULT_CONTAINER_PREFIX = "aluno_";

// Global declaration for Google Identity Services
declare const google: any;

export default function App() {
  // --- State ---
  
  // Azure Configuration
  const [azureConfig, setAzureConfig] = useState<AzureConfig>({
    accountName: DEFAULT_ACCOUNT_NAME,
    containerName: "", // Usuário deve preencher (ex: aluno_nome)
    sasToken: DEFAULT_SAS_TOKEN
  });

  // Google Configuration
  const [googleConfig, setGoogleConfig] = useState<GoogleConfig>({
    clientId: "", // Usuário deve preencher no console
    apiKey: "",   // Usuário deve preencher no console
    accessToken: undefined
  });
  
  const [showSettings, setShowSettings] = useState(false);
  const [isGoogleReady, setIsGoogleReady] = useState(false);
  
  // Files
  const [sourceFiles, setSourceFiles] = useState<CloudFile[]>([]);
  const [destFiles, setDestFiles] = useState<CloudFile[]>([]);
  
  // Loading States
  const [loadingSource, setLoadingSource] = useState(false);
  const [loadingDest, setLoadingDest] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  
  // Transfer Logic
  const [transferQueue, setTransferQueue] = useState<TransferItem[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const tokenClient = useRef<any>(null);

  // AI
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // --- Effects ---

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Initialize Google Token Client when Client ID changes
  useEffect(() => {
    if (googleConfig.clientId && typeof google !== 'undefined') {
      try {
        tokenClient.current = google.accounts.oauth2.initTokenClient({
          client_id: googleConfig.clientId,
          scope: 'https://www.googleapis.com/auth/drive.readonly',
          callback: (response: any) => {
            if (response.access_token) {
              setGoogleConfig(prev => ({ ...prev, accessToken: response.access_token }));
              addLog("Login no Google realizado com sucesso!", "SUCCESS");
              setIsGoogleReady(true);
              // Fetch files immediately after login
              fetchGoogleFiles(response.access_token);
            } else {
              addLog("Erro na autenticação Google.", "ERROR");
            }
          },
        });
        addLog("Cliente Google OAuth inicializado.", "INFO");
      } catch (e) {
        console.error(e);
        addLog(`Erro ao inicializar Google Identity: ${e}`, "ERROR");
      }
    }
  }, [googleConfig.clientId]);

  // --- Helpers ---

  const addLog = (message: string, level: LogEntry['level'] = 'INFO') => {
    setLogs(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), level, message }]);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    addLog("Texto copiado para a área de transferência.", "INFO");
  };

  // --- Actions ---

  const handleGoogleLogin = () => {
    if (!googleConfig.clientId || !googleConfig.apiKey) {
      addLog("CONFIGURAÇÃO NECESSÁRIA: Insira seu Client ID e API Key do Google nas Configurações.", "WARNING");
      setShowSettings(true);
      return;
    }
    if (tokenClient.current) {
      tokenClient.current.requestAccessToken();
    } else {
      addLog("Cliente Google não inicializado. Verifique se o Client ID está correto.", "ERROR");
    }
  };

  const fetchGoogleFiles = async (token: string) => {
    setLoadingSource(true);
    addLog("Buscando lista de arquivos no Google Drive...", "INFO");
    try {
      const files = await listDriveFiles(token, googleConfig.apiKey);
      setSourceFiles(files);
      addLog(`Sucesso: ${files.length} arquivos encontrados no Google Drive.`, "SUCCESS");
    } catch (err: any) {
      addLog(`Falha ao buscar arquivos Google: ${err.message}`, "ERROR");
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
    if (!azureConfig.containerName) {
      addLog("CONFIGURAÇÃO NECESSÁRIA: Insira o nome do Contêiner Azure (ex: aluno_xxx).", "WARNING");
      setShowSettings(true);
      return;
    }
    
    setLoadingDest(true);
    addLog(`Conectando ao Azure Blob Storage (Container: ${azureConfig.containerName})...`, "INFO");
    
    try {
      const files = await listBlobs(azureConfig);
      setDestFiles(files);
      addLog(`Conectado ao Azure! ${files.length} arquivos encontrados no destino.`, "SUCCESS");
    } catch (err: any) {
      addLog(`Falha na conexão Azure: ${err.message}`, "ERROR");
      if (err.message.includes("404")) {
         addLog(`Dica: Verifique se o contêiner '${azureConfig.containerName}' realmente existe na conta '${azureConfig.accountName}'.`, "WARNING");
      } else if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
         addLog(`ALERTA DE CORS: O navegador foi bloqueado pelo Azure. Verifique a aba 'Configurações' > 'Configuração CORS'.`, "WARNING");
      }
    } finally {
      setLoadingDest(false);
    }
  };

  const handleStartMigration = async () => {
    if (sourceFiles.length === 0) {
      addLog("Nenhum arquivo de origem para migrar.", "WARNING");
      return;
    }
    if (!azureConfig.containerName) {
      addLog("Contêiner de destino não configurado.", "ERROR");
      setShowSettings(true);
      return;
    }
    if (!googleConfig.accessToken) {
      addLog("Sessão do Google expirada. Faça login novamente.", "ERROR");
      return;
    }

    setIsTransferring(true);
    addLog(">>> INICIANDO SEQUÊNCIA DE MIGRAÇÃO <<<", "INFO");
    setAiAnalysis(null);

    // Initialize Queue
    const queue: TransferItem[] = sourceFiles.map(f => ({
      file: f,
      status: TransferStatus.PENDING,
      progress: 0
    }));
    setTransferQueue(queue);

    // Process Queue
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      
      // Update status to In Progress
      setTransferQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: TransferStatus.IN_PROGRESS } : q));
      addLog(`Processando arquivo ${i + 1}/${queue.length}: ${item.file.name}`, "INFO");

      try {
        // 1. Download from Google (Real)
        addLog(`Baixando do Google Drive...`, "INFO");
        const blob = await downloadDriveFile(item.file.id, googleConfig.accessToken, googleConfig.apiKey, item.file.mimeType);
        
        // Attach real content to file object
        const fileWithContent = { ...item.file, content: blob };

        // 2. Upload to Azure
        addLog(`Enviando para Azure Blob Storage...`, "INFO");
        await uploadBlob(fileWithContent, azureConfig, (progress) => {
          setTransferQueue(prev => prev.map((q, idx) => idx === i ? { ...q, progress } : q));
        });
        
        // Success
        setTransferQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: TransferStatus.COMPLETED, progress: 100 } : q));
        addLog(`SUCESSO: ${item.file.name} migrado.`, "SUCCESS");
        
      } catch (err: any) {
        // Error
        let msg = err.message;
        if (msg.includes("NetworkError") || msg.includes("Failed to fetch")) {
           msg = "Erro de Rede/CORS. Verifique as configurações do Azure.";
        }
        setTransferQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: TransferStatus.ERROR, message: msg } : q));
        addLog(`ERRO ao transferir ${item.file.name}: ${msg}`, "ERROR");
      }
    }

    setIsTransferring(false);
    addLog(">>> MIGRAÇÃO FINALIZADA <<<", "INFO");
    handleFetchDest(); // Refresh destination
  };

  const handleAiAnalysis = async () => {
    if (logs.length === 0) return;
    setAnalyzing(true);
    const result = await analyzeMigrationLogs(logs);
    setAiAnalysis(result);
    setAnalyzing(false);
  };

  // --- Render ---

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-blue-500/30">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Cloud className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-tight text-white">CloudMigrate Pro</h1>
              <p className="text-xs text-slate-400">Google Drive para Azure Blob Storage</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
             <button 
              onClick={() => setShowSettings(!showSettings)}
              className={`flex items-center gap-2 p-2 rounded-md transition-colors ${showSettings ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
              title="Configurações"
            >
              <Settings className="w-5 h-5" />
              <span className="text-xs font-medium hidden sm:block">Configurações</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-4 space-y-6">
        
        {/* Settings Panel */}
        {showSettings && (
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 shadow-2xl animate-in fade-in slide-in-from-top-4 mb-6">
             <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
               <Settings className="w-6 h-6 text-slate-400" />
               Painel de Configuração
             </h2>
             
             <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Azure Settings */}
                <div className="space-y-4">
                  <h3 className="text-white font-semibold flex items-center gap-2 border-b border-slate-700 pb-2 text-sm uppercase tracking-wide">
                    <Server className="w-4 h-4 text-blue-400" />
                    Azure Blob Storage
                  </h3>
                  
                  {/* CORS GUIDE */}
                  <div className="bg-blue-900/20 border border-blue-800/50 rounded-lg p-4 space-y-2">
                    <div className="flex items-start gap-2">
                       <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                       <h4 className="text-sm font-semibold text-blue-300">Configuração Obrigatória (CORS)</h4>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                       Para rodar sem backend, vá ao <strong>Portal Azure > Storage Account > Resource Sharing (CORS)</strong> e adicione esta regra na aba "Blob service":
                    </p>
                    <ul className="text-[10px] text-slate-400 space-y-1 list-disc pl-4 font-mono">
                       <li>Allowed origins: <span className="text-green-400">*</span> (ou seu domínio Vercel)</li>
                       <li>Allowed methods: <span className="text-green-400">GET, PUT, OPTIONS</span></li>
                       <li>Allowed headers: <span className="text-green-400">*</span> (Importante!)</li>
                       <li>Exposed headers: <span className="text-green-400">*</span></li>
                       <li>Max age: <span className="text-green-400">86400</span></li>
                    </ul>
                  </div>

                  <div className="space-y-3">
                    <label className="text-xs font-medium text-slate-400 uppercase">Nome da Conta</label>
                    <input 
                      type="text" 
                      value={azureConfig.accountName}
                      readOnly
                      className="w-full bg-slate-950/50 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-500 cursor-not-allowed font-mono"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-xs font-medium text-slate-400 uppercase">Nome do Contêiner (Obrigatório)</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={azureConfig.containerName}
                        placeholder="Ex: aluno_joao"
                        onChange={(e) => setAzureConfig({...azureConfig, containerName: e.target.value})}
                        className="flex-1 bg-slate-950 border border-blue-500/50 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-blue-400 text-white shadow-[0_0_10px_rgba(59,130,246,0.1)]"
                      />
                    </div>
                    <p className="text-[10px] text-slate-500">
                      * O contêiner deve ser criado manualmente no portal antes.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <label className="text-xs font-medium text-slate-400 uppercase">SAS Token</label>
                    <textarea 
                      value={azureConfig.sasToken}
                      readOnly
                      rows={2}
                      className="w-full bg-slate-950/50 border border-slate-700 rounded-md px-3 py-2 text-[10px] font-mono text-slate-600 cursor-not-allowed resize-none"
                    />
                  </div>
                </div>

                {/* Google Settings */}
                <div className="space-y-4">
                  <h3 className="text-white font-semibold flex items-center gap-2 border-b border-slate-700 pb-2 text-sm uppercase tracking-wide">
                    <Cloud className="w-4 h-4 text-green-400" />
                    Google Drive API
                  </h3>
                  
                  <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700 space-y-3">
                     <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 uppercase font-bold">Origem Permitida</span>
                        <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1">
                          Console Google <ExternalLink className="w-3 h-3" />
                        </a>
                     </div>
                     <p className="text-[11px] text-slate-400">
                       Copie esta URL e adicione em "Origens JavaScript autorizadas" no seu Client ID:
                     </p>
                     <div className="flex gap-2">
                       <code className="flex-1 text-xs text-green-300 font-mono bg-slate-900 px-3 py-2 rounded border border-slate-700 overflow-x-auto whitespace-nowrap">
                         {window.location.origin}
                       </code>
                       <button onClick={() => copyToClipboard(window.location.origin)} className="bg-slate-700 hover:bg-slate-600 text-slate-200 p-2 rounded transition-colors" title="Copiar URL">
                         <Copy className="w-4 h-4" />
                       </button>
                     </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-xs font-medium text-slate-400 uppercase">Client ID (OAuth 2.0)</label>
                    <input 
                      type="text" 
                      placeholder="Ex: 123456-abcde.apps.googleusercontent.com"
                      value={googleConfig.clientId}
                      onChange={(e) => setGoogleConfig({...googleConfig, clientId: e.target.value})}
                      className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-green-500 text-white font-mono"
                    />
                  </div>
                  <div className="space-y-3">
                    <label className="text-xs font-medium text-slate-400 uppercase">API Key</label>
                    <input 
                      type="password" 
                      placeholder="Ex: AIzaSyD..."
                      value={googleConfig.apiKey}
                      onChange={(e) => setGoogleConfig({...googleConfig, apiKey: e.target.value})}
                      className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm font-mono text-slate-400 focus:outline-none focus:border-green-500"
                    />
                  </div>
                </div>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-800 flex justify-end">
              <button 
                onClick={() => setShowSettings(false)}
                className="bg-slate-700 hover:bg-slate-600 text-white px-8 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-lg hover:shadow-slate-700/50"
              >
                Salvar Configurações
              </button>
            </div>
          </div>
        )}

        {/* Workspace Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[600px]">
          
          {/* Left: Source */}
          <div className="lg:col-span-4 h-full flex flex-col gap-4">
             <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-slate-300 font-medium text-sm">Origem</h2>
                  {googleConfig.accessToken ? (
                    <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full border border-green-500/30">Conectado</span>
                  ) : (
                    <span className="text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">Desconectado</span>
                  )}
                </div>
                
                {googleConfig.accessToken ? (
                  <button onClick={handleFetchSource} disabled={loadingSource || isTransferring} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                    <RefreshCw className={`w-3 h-3 ${loadingSource ? 'animate-spin' : ''}`} /> Atualizar
                  </button>
                ) : (
                  <button onClick={handleGoogleLogin} className="text-xs bg-slate-800 hover:bg-slate-700 text-white px-3 py-1 rounded flex items-center gap-1 transition-colors border border-slate-700">
                    <LogIn className="w-3 h-3" /> Login Google
                  </button>
                )}
             </div>
             <FileTable 
                title="Google Drive" 
                icon={<Cloud className="w-5 h-5 text-green-500" />} 
                files={sourceFiles} 
                isLoading={loadingSource}
                emptyMessage={!googleConfig.accessToken ? "Faça login para ver seus arquivos" : "Nenhum arquivo encontrado"}
             />
          </div>

          {/* Center: Controls & Status */}
          <div className="lg:col-span-4 h-full flex flex-col gap-4">
            <div className="flex-none bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg flex flex-col items-center justify-center text-center space-y-4">
              <div className="p-4 bg-slate-800/50 rounded-full">
                <ArrowRight className={`w-8 h-8 text-slate-400 ${isTransferring ? 'animate-pulse text-blue-400' : ''}`} />
              </div>
              <div>
                <h3 className="text-white font-semibold">Controle de Migração</h3>
                <p className="text-xs text-slate-500 mt-1">
                  {isTransferring ? 'Transferindo arquivos...' : 'Pronto para iniciar'}
                </p>
              </div>
              
              <button
                onClick={handleStartMigration}
                disabled={isTransferring || sourceFiles.length === 0}
                className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-bold text-white transition-all transform active:scale-95
                  ${isTransferring || sourceFiles.length === 0 
                    ? 'bg-slate-700 cursor-not-allowed opacity-50' 
                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-lg shadow-blue-500/20'
                  }`}
              >
                {isTransferring ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Processando...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 fill-current" />
                    Iniciar Migração
                  </>
                )}
              </button>
            </div>

            {/* Transfer List */}
            <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
              <div className="p-3 border-b border-slate-800 bg-slate-800/50 text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Status da Transferência
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {transferQueue.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-2 opacity-50">
                    <Cloud className="w-8 h-8" />
                    <span className="text-xs">Aguardando início...</span>
                  </div>
                ) : (
                  transferQueue.map((item, idx) => (
                    <div key={idx} className="bg-slate-950 p-3 rounded border border-slate-800 text-xs">
                      <div className="flex justify-between items-center mb-2">
                        <span className="truncate text-slate-300 max-w-[150px]">{item.file.name}</span>
                        {item.status === TransferStatus.COMPLETED && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                        {item.status === TransferStatus.ERROR && <AlertCircle className="w-4 h-4 text-red-500" />}
                        {item.status === TransferStatus.IN_PROGRESS && <span className="text-blue-400 font-mono">{Math.round(item.progress)}%</span>}
                        {item.status === TransferStatus.PENDING && <span className="text-slate-600">Fila</span>}
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-300 ${
                            item.status === TransferStatus.ERROR ? 'bg-red-500' : 
                            item.status === TransferStatus.COMPLETED ? 'bg-green-500' : 'bg-blue-500'
                          }`}
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      {item.message && <div className="text-[10px] text-red-400 mt-1 truncate">{item.message}</div>}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right: Destination */}
          <div className="lg:col-span-4 h-full flex flex-col gap-4">
             <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1">
                  <h2 className="text-slate-300 font-medium text-sm">Destino</h2>
                  {azureConfig.containerName && <span className="text-[10px] text-slate-500">({azureConfig.containerName})</span>}
                </div>
                <button onClick={handleFetchDest} disabled={loadingDest || isTransferring} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                  <RefreshCw className={`w-3 h-3 ${loadingDest ? 'animate-spin' : ''}`} /> Atualizar
                </button>
             </div>
             <FileTable 
                title="Azure Blob Storage" 
                icon={<Server className="w-5 h-5 text-blue-500" />} 
                files={destFiles} 
                isLoading={loadingDest}
                emptyMessage={!azureConfig.containerName ? "Configure o nome do contêiner" : "Nenhum blob encontrado"}
             />
          </div>
        </div>

        {/* Bottom: Console & AI */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-64">
           {/* Terminal */}
           <div className="lg:col-span-2 bg-slate-950 border border-slate-800 rounded-xl flex flex-col font-mono text-xs overflow-hidden shadow-inner">
             <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center gap-2 text-slate-400">
               <Terminal className="w-4 h-4" />
               <span>Log do Sistema</span>
             </div>
             <div className="flex-1 overflow-y-auto p-4 space-y-1">
                {logs.length === 0 && <div className="text-slate-600 italic">Sistema inicializado. Pronto.</div>}
                {logs.map((log, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-slate-500">[{log.timestamp}]</span>
                    <span className={`
                      ${log.level === 'ERROR' ? 'text-red-400' : ''}
                      ${log.level === 'SUCCESS' ? 'text-green-400' : ''}
                      ${log.level === 'WARNING' ? 'text-yellow-400' : ''}
                      ${log.level === 'INFO' ? 'text-blue-200' : ''}
                    `}>
                      {log.level}:
                    </span>
                    <span className="text-slate-300">{log.message}</span>
                  </div>
                ))}
                <div ref={logsEndRef} />
             </div>
           </div>

           {/* AI Insight */}
           <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col relative overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                 <div className="flex items-center gap-2 text-purple-400 font-semibold">
                    <BrainCircuit className="w-5 h-5" />
                    <span>Análise Gemini IA</span>
                 </div>
                 {logs.length > 0 && !analyzing && (
                   <button onClick={handleAiAnalysis} className="text-xs bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 px-2 py-1 rounded transition-colors">
                     Gerar Relatório
                   </button>
                 )}
              </div>
              
              <div className="flex-1 overflow-y-auto text-sm text-slate-300 leading-relaxed">
                {analyzing ? (
                   <div className="flex flex-col items-center justify-center h-full text-purple-400 gap-2">
                     <RefreshCw className="w-6 h-6 animate-spin" />
                     <span className="text-xs">Gerando insights...</span>
                   </div>
                ) : aiAnalysis ? (
                   <div className="prose prose-invert prose-sm">
                      <p className="whitespace-pre-line">{aiAnalysis}</p>
                   </div>
                ) : (
                   <div className="h-full flex items-center justify-center text-center text-slate-600 text-xs p-4 border border-dashed border-slate-800 rounded-lg">
                     Realize uma migração para obter análise de desempenho e erros via IA.
                   </div>
                )}
              </div>
           </div>
        </div>

      </main>
    </div>
  );
}