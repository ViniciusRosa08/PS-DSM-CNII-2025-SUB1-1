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
  Info,
  Copy,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  X,
  AlertTriangle,
  PlusCircle,
  Globe,
  ShieldAlert
} from 'lucide-react';
import { FileTable } from './components/FileTable';
import { listBlobs, uploadBlob, createContainer } from './services/azureService';
import { listDriveFiles, downloadDriveFile } from './services/googleService';
import { CloudFile, AzureConfig, TransferItem, TransferStatus, LogEntry, GoogleConfig } from './types';

// Constants - Credenciais fornecidas
const DEFAULT_ACCOUNT_NAME = "stop2cn2";
const DEFAULT_SAS_TOKEN = "sv=2024-11-04&ss=bfqt&srt=sco&sp=rwdlacupiytfx&se=2025-12-25T06:02:21Z&st=2025-11-24T21:47:21Z&spr=https&sig=pzsca0jLZTRZNDzAvWlDRcF9dTq6MKHzXTTRQtBNY4U%3D";
const DEFAULT_GOOGLE_CLIENT_ID = "83789597916-40gh712a71scnvf8p9pamumqjaci1100.apps.googleusercontent.com";
const DEFAULT_GOOGLE_API_KEY = "AIzaSyBjMOADZNDhkp1ubfgJvui5UTnQcnzTBGg";

// Detecta URL atual automaticamente para facilitar configuração
const CURRENT_DOMAIN = typeof window !== 'undefined' ? window.location.origin : "https://ps-dsm-cnii-2025-sub-1-1.vercel.app";

// Interface global para o Window
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
  const [azureConfig, setAzureConfig] = useState<AzureConfig>({
    accountName: DEFAULT_ACCOUNT_NAME,
    containerName: "aluno-vinicius", 
    sasToken: DEFAULT_SAS_TOKEN
  });

  // Google Configuration
  const [googleConfig, setGoogleConfig] = useState<GoogleConfig>({
    clientId: DEFAULT_GOOGLE_CLIENT_ID, 
    apiKey: DEFAULT_GOOGLE_API_KEY,   
    accessToken: undefined
  });
  
  const [showSettings, setShowSettings] = useState(false);
  const [showGoogleGuide, setShowGoogleGuide] = useState(true); // Default open to help user
  const [showCorsModal, setShowCorsModal] = useState(false);
  const [containerNotFound, setContainerNotFound] = useState(false);
  
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

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Carregar Azure automaticamente se estiver configurado
  useEffect(() => {
    if (azureConfig.accountName && azureConfig.sasToken) {
       handleFetchDest();
    }
  }, []);

  // Validate Container Name on Change
  useEffect(() => {
    const name = azureConfig.containerName;
    if (name.includes('_')) {
      setContainerNameError("O Azure PROÍBE underline (_). Use hífen (-).");
    } else if (/[^a-z0-9-]/.test(name)) {
      setContainerNameError("Apenas letras minúsculas, números e hífen (-).");
    } else if (name.length < 3) {
      setContainerNameError("Mínimo de 3 caracteres.");
    } else {
      setContainerNameError(null);
    }
  }, [azureConfig.containerName]);

  // Inicializar Google Auth com Retry (Robusto para Vercel)
  useEffect(() => {
    const initGoogle = () => {
      const g = (window as any).google;
      if (googleConfig.clientId && g && g.accounts) {
        try {
          tokenClient.current = g.accounts.oauth2.initTokenClient({
            client_id: googleConfig.clientId,
            scope: 'https://www.googleapis.com/auth/drive.readonly',
            ux_mode: 'popup',
            callback: (response: any) => {
              if (response.access_token) {
                setGoogleConfig(prev => ({ ...prev, accessToken: response.access_token }));
                addLog("Autenticação Google realizada com sucesso!", "SUCCESS");
                // Usamos o token retornado diretamente
                fetchGoogleFiles(response.access_token);
              } else {
                // Verifica se foi erro de popup fechado ou erro de origem
                if (response.error) {
                  addLog(`Erro OAuth: ${response.error}`, "ERROR");
                  // Se o erro for invalid_request, geralmente é Origin Mismatch
                  if (response.error === 'invalid_request' || response.error.includes('origin_mismatch')) {
                      setShowSettings(true);
                      setShowGoogleGuide(true);
                      alert(`ERRO DE ORIGEM GOOGLE:\n\nVerifique se a URL:\n${CURRENT_DOMAIN}\n\nestá nas "Origens JavaScript autorizadas" do Google Cloud (SEM BARRA NO FINAL).\n\nVerifique também se o tipo do aplicativo é "Aplicação Web".`);
                  }
                }
              }
            },
          });
          addLog("Sistema de autenticação Google pronto.", "INFO");
          return true;
        } catch (e) {
          console.error(e);
          addLog(`Erro ao inicializar Google Identity: ${e}`, "ERROR");
          return false;
        }
      }
      return false;
    };

    // Tenta inicializar imediatamente
    if (!initGoogle()) {
      // Se falhar (script ainda carregando), tenta a cada 500ms
      const intervalId = setInterval(() => {
        if (initGoogle()) {
          clearInterval(intervalId);
        }
      }, 500);
      return () => clearInterval(intervalId);
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
      addLog("CONFIGURAÇÃO NECESSÁRIA: Chaves de API não configuradas.", "ERROR");
      setShowSettings(true);
      return;
    }
    if (tokenClient.current) {
      // Força prompt para garantir seleção de conta e evitar loops silenciosos
      tokenClient.current.requestAccessToken({ prompt: 'consent' });
    } else {
      addLog("Aguardando carregamento do sistema Google...", "WARNING");
      // Tenta recuperar se o cliente não estiver pronto
      const g = (window as any).google;
      if (g && g.accounts) {
        // Tenta reinit rapido
        try {
           tokenClient.current = g.accounts.oauth2.initTokenClient({
            client_id: googleConfig.clientId,
            scope: 'https://www.googleapis.com/auth/drive.readonly',
            ux_mode: 'popup',
            callback: (res: any) => {
               if(res.access_token) setGoogleConfig(p => ({...p, accessToken: res.access_token}));
            }
           });
           tokenClient.current.requestAccessToken();
        } catch(e) {
           addLog("Cliente Google não inicializado. Recarregue a página.", "ERROR");
        }
      }
    }
  };

  const fetchGoogleFiles = async (token: string) => {
    if (!token || !googleConfig.apiKey) {
        addLog("Token ou Chave ausentes. Faça login.", "WARNING");
        return;
    }

    setLoadingSource(true);
    addLog("Listando arquivos do Google Drive...", "INFO");
    try {
      const files = await listDriveFiles(token, googleConfig.apiKey);
      setSourceFiles(files);
      addLog(`Origem: ${files.length} arquivos encontrados.`, "SUCCESS");
    } catch (err: any) {
      addLog(`Falha ao buscar Google: ${err.message}`, "ERROR");
      // Se der erro de autenticação, remove o token inválido
      if (err.message.includes("401") || err.message.includes("403")) {
          setGoogleConfig(prev => ({ ...prev, accessToken: undefined }));
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
    if (!azureConfig.containerName) {
      addLog("Configure o nome do contêiner Azure.", "WARNING");
      setShowSettings(true);
      return;
    }
    
    setLoadingDest(true);
    setContainerNotFound(false); // Reset status
    addLog(`Conectando ao Azure (Container: ${azureConfig.containerName})...`, "INFO");
    
    try {
      const files = await listBlobs(azureConfig);
      setDestFiles(files);
      addLog(`Destino: Conectado. ${files.length} arquivos existentes.`, "SUCCESS");
    } catch (err: any) {
      if (err.message.includes("404")) {
         addLog(`ERRO 404: Contêiner '${azureConfig.containerName}' NÃO EXISTE no Azure. Crie-o nas configurações.`, "WARNING");
         setContainerNotFound(true);
         setDestFiles([]); // Limpa lista
      } else {
         addLog(`Falha Azure: ${err.message}`, "ERROR");
         if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
            setShowCorsModal(true);
         }
      }
    } finally {
      setLoadingDest(false);
    }
  };

  const handleCreateContainer = async () => {
    const containerName = azureConfig.containerName.toLowerCase().trim();
    
    if (containerNameError) {
      addLog(`Nome inválido: ${containerNameError}`, "WARNING");
      return;
    }

    if (!containerName) {
      addLog("Defina um nome válido para o contêiner.", "WARNING");
      return;
    }

    setCreatingContainer(true);
    addLog(`Criando contêiner '${containerName}' no Azure...`, "INFO");
    try {
      await createContainer(azureConfig);
      addLog(`Contêiner '${containerName}' criado com sucesso!`, "SUCCESS");
      setContainerNotFound(false);
      // Atualiza automaticamente a lista (que deve vir vazia, mas confirma a conexão)
      setTimeout(handleFetchDest, 1000);
    } catch (err: any) {
      let msg = err.message;
      if (msg.includes("Failed to fetch")) msg = "Bloqueio CORS Azure (Mas verifique se o nome é único)";
      else if (msg.includes("409")) msg = "Este contêiner já existe.";
      
      addLog(`Erro ao criar contêiner: ${msg}`, "ERROR");
      if (msg.includes("CORS")) setShowCorsModal(true);
    } finally {
      setCreatingContainer(false);
    }
  };

  const handleStartMigration = async () => {
    if (sourceFiles.length === 0) return;
    if (!azureConfig.containerName) {
      setShowSettings(true);
      return;
    }
    if (!googleConfig.accessToken) {
      addLog("Sessão expirada. Faça login no Google novamente.", "ERROR");
      return;
    }

    setIsTransferring(true);
    addLog(">>> INICIANDO MIGRAÇÃO DE ARQUIVOS <<<", "INFO");

    const queue: TransferItem[] = sourceFiles.map(f => ({
      file: f,
      status: TransferStatus.PENDING,
      progress: 0
    }));
    setTransferQueue(queue);

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      setTransferQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: TransferStatus.IN_PROGRESS } : q));
      addLog(`Transferindo ${i + 1}/${queue.length}: ${item.file.name}`, "INFO");

      try {
        // 1. Download / Exportação (Lógica robusta)
        const isWorkspace = item.file.mimeType.includes("google-apps");
        
        const blob = await downloadDriveFile(
            item.file.id, 
            googleConfig.accessToken, 
            googleConfig.apiKey, 
            item.file.mimeType
        );
        
        // 2. Renomear arquivo baseado no BLOB recebido (Extensão correta)
        let destFileName = item.file.name;
        const blobType = blob.type; 

        if (isWorkspace) {
            const lowerName = destFileName.toLowerCase();
            // Adiciona .pdf se for documento ou apresentação e ainda não tiver
            if (blobType.includes('pdf') && !lowerName.endsWith('.pdf')) {
                destFileName += '.pdf';
            } 
            // Adiciona .xlsx se for planilha e ainda não tiver
            else if (blobType.includes('spreadsheet') && !lowerName.endsWith('.xlsx')) {
                destFileName += '.xlsx';
            }
        }

        const fileWithContent: CloudFile = { 
            ...item.file, 
            name: destFileName, 
            mimeType: blobType, // Usa o mime type real do arquivo baixado (ex: application/pdf)
            content: blob 
        };

        // 3. Upload Azure
        await uploadBlob(fileWithContent, azureConfig, (progress) => {
          setTransferQueue(prev => prev.map((q, idx) => idx === i ? { ...q, progress } : q));
        });
        
        setTransferQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: TransferStatus.COMPLETED, progress: 100 } : q));
        addLog(`Sucesso: Arquivo salvo como ${destFileName}`, "SUCCESS");
        
      } catch (err: any) {
        let msg = err.message;
        if (msg.includes("Failed to fetch")) msg = "Bloqueio CORS Azure";
        setTransferQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: TransferStatus.ERROR, message: msg } : q));
        addLog(`ERRO na transferência: ${msg}`, "ERROR");
      }
    }

    setIsTransferring(false);
    addLog("Migração finalizada.", "INFO");
    handleFetchDest(); 
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-blue-500/30 overflow-x-hidden">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg shrink-0">
              <Cloud className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-base sm:text-lg leading-tight tracking-tight text-white">CloudMigrate Pro</h1>
              <p className="text-[10px] sm:text-xs text-slate-400">Drive to Azure</p>
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
      <main className="w-full max-w-7xl mx-auto p-2 sm:p-4 space-y-4 sm:space-y-6">
        
        {/* CORS ERROR MODAL */}
        {showCorsModal && (
           <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
             <div className="bg-slate-900 border border-red-500/50 rounded-xl p-0 w-[95%] max-w-lg shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
               <div className="bg-red-500/10 border-b border-red-500/20 p-4 sm:p-6 flex items-start gap-4">
                  <div className="bg-red-500/20 p-2 sm:p-3 rounded-full shrink-0">
                    <AlertTriangle className="w-6 h-6 sm:w-8 sm:h-8 text-red-500" />
                  </div>
                  <div>
                    <h2 className="text-lg sm:text-xl font-bold text-white mb-1">Bloqueio de Segurança Azure (CORS)</h2>
                    <p className="text-slate-300 text-xs sm:text-sm">
                       O servidor do Azure recusou a conexão. Isso é comum se o domínio Vercel não foi liberado lá.
                    </p>
                  </div>
                  <button onClick={() => setShowCorsModal(false)} className="text-slate-400 hover:text-white absolute top-4 right-4">
                    <X className="w-6 h-6" />
                  </button>
               </div>
               <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs sm:text-sm text-slate-300">
                 <p className="font-semibold text-white">Soluções possíveis:</p>
                 <ul className="list-disc list-inside space-y-2">
                   <li>O professor precisa autorizar o domínio <code>{CURRENT_DOMAIN}</code> no CORS da Storage Account.</li>
                   <li>Se isso não for possível, teste rodando localmente (Localhost) ou peça para o administrador do Azure liberar acesso.</li>
                 </ul>
               </div>
               <div className="p-4 border-t border-slate-800 bg-slate-900/50 flex justify-end">
                 <button onClick={() => setShowCorsModal(false)} className="bg-slate-700 text-white px-4 py-2 rounded text-sm">Fechar</button>
               </div>
             </div>
           </div>
        )}

        {/* Settings Modal */}
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-10 sm:pt-20 bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
             <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 sm:p-6 shadow-2xl w-full max-w-3xl relative">
                <button 
                  onClick={() => setShowSettings(false)}
                  className="absolute top-4 right-4 text-slate-500 hover:text-white"
                >
                  <X className="w-6 h-6" />
                </button>

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
                      
                      <div className="bg-blue-900/20 border border-blue-500/20 rounded p-3 text-xs text-blue-300">
                        <Info className="w-3 h-3 inline mr-1" />
                        Credenciais carregadas automaticamente.
                      </div>

                      <div className="space-y-3">
                        <label className="text-xs font-medium text-slate-400 uppercase">Nome do Contêiner (Obrigatório)</label>
                        <div className="flex flex-col gap-2">
                            <div className="flex flex-col sm:flex-row gap-2">
                              <input 
                                type="text" 
                                value={azureConfig.containerName}
                                placeholder="ex: aluno-vinicius"
                                onChange={(e) => setAzureConfig({...azureConfig, containerName: e.target.value.toLowerCase()})}
                                className={`flex-1 bg-slate-950 border rounded-md px-3 py-2 text-sm focus:outline-none text-white
                                  ${containerNameError ? 'border-red-500 focus:border-red-500' : 
                                    containerNotFound ? 'border-yellow-500 focus:border-yellow-400' : 'border-blue-500/50 focus:border-blue-400'}
                                `}
                              />
                              <button 
                                onClick={handleCreateContainer}
                                disabled={creatingContainer || !!containerNameError}
                                className={`px-4 py-2 rounded-md text-xs sm:text-sm font-medium flex items-center justify-center gap-1 transition-colors
                                  ${creatingContainer || !!containerNameError 
                                    ? 'bg-slate-700 text-slate-500 cursor-not-allowed' 
                                    : containerNotFound 
                                        ? 'bg-yellow-600 hover:bg-yellow-500 text-white animate-pulse'
                                        : 'bg-blue-600 hover:bg-blue-500 text-white'}
                                `}
                              >
                                {creatingContainer ? <RefreshCw className="w-3 h-3 animate-spin"/> : <PlusCircle className="w-4 h-4" />}
                                {containerNotFound ? "CRIAR AGORA" : "Criar"}
                              </button>
                            </div>
                            {containerNameError && (
                              <p className="text-[10px] text-red-400 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                {containerNameError}
                              </p>
                            )}
                             {containerNotFound && !containerNameError && (
                              <p className="text-[10px] text-yellow-400 flex items-center gap-1 font-bold">
                                <AlertCircle className="w-3 h-3" />
                                Contêiner não encontrado. Clique em CRIAR AGORA.
                              </p>
                            )}
                            <p className="text-[10px] text-slate-500">Regras Azure: Letras minúsculas, números e hifens. <strong className="text-red-400">Sem underline (_).</strong></p>
                        </div>
                      </div>
                    </div>

                    {/* Google Settings */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-700 pb-2">
                        <h3 className="text-white font-semibold flex items-center gap-2 text-sm uppercase tracking-wide">
                            <Cloud className="w-4 h-4 text-green-400" />
                            Google Drive API
                        </h3>
                      </div>
                      
                      {/* REAL CONFIGURATION */}
                      <div className="space-y-4">
                          <button 
                            onClick={() => setShowGoogleGuide(!showGoogleGuide)}
                            className="w-full text-left bg-slate-800/50 hover:bg-slate-800 border border-slate-700 p-3 rounded-lg flex items-center justify-between transition-all group"
                          >
                            <div className="flex items-center gap-2">
                              <HelpCircle className="w-4 h-4 text-green-400" />
                              <span className="text-xs font-semibold text-slate-300 group-hover:text-white">Diagnóstico: Erro Google 400</span>
                            </div>
                            {showGoogleGuide ? <ChevronUp className="w-4 h-4 text-slate-500"/> : <ChevronDown className="w-4 h-4 text-slate-500"/>}
                          </button>

                          {showGoogleGuide && (
                            <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-3 space-y-3 text-[11px] text-slate-300 leading-relaxed">
                              <div className="flex items-center gap-2 text-green-300 mb-2">
                                <Globe className="w-3 h-3"/>
                                <strong>Sua URL atual (Origem):</strong>
                              </div>
                              
                              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
                                   <code className="flex-1 text-green-300 bg-slate-900 p-2 rounded border border-slate-700 break-all font-mono">{CURRENT_DOMAIN}</code>
                                   <button onClick={() => copyToClipboard(CURRENT_DOMAIN)} className="text-white bg-slate-700 p-2 rounded hover:bg-slate-600 shrink-0"><Copy className="w-3 h-3"/></button>
                              </div>

                              <div className="flex items-start gap-2 text-red-400 bg-red-900/10 p-2 rounded border border-red-500/20 mb-2">
                                <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                                <div>
                                  <p className="font-bold">Checklist Obrigatório:</p>
                                  <ul className="list-disc list-inside space-y-1 mt-1 text-[10px]">
                                    <li>Adicione a URL acima nas <strong>Origens JavaScript</strong> (NÃO no URI de redirecionamento).</li>
                                    <li><strong>Sem barra</strong> no final (/).</li>
                                    <li>Tipo do aplicativo deve ser <strong>"Aplicação da Web"</strong> (Web Application).</li>
                                    <li>Se o projeto estiver em <strong>"Teste"</strong>, adicione seu email aos usuários de teste.</li>
                                  </ul>
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="space-y-3">
                            <label className="text-xs font-medium text-slate-400 uppercase">Client ID</label>
                            <input 
                              type="text" 
                              value={googleConfig.clientId}
                              onChange={(e) => setGoogleConfig({...googleConfig, clientId: e.target.value})}
                              className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-white font-mono"
                            />
                            {googleConfig.clientId.includes('8378') && (
                               <p className="text-[10px] text-yellow-500">Nota: O nome 'SoloQuest' na tela de login pertence a este ID. É normal.</p>
                            )}
                          </div>
                          <div className="space-y-3">
                            <label className="text-xs font-medium text-slate-400 uppercase">API Key</label>
                            <input 
                              type="password" 
                              value={googleConfig.apiKey}
                              onChange={(e) => setGoogleConfig({...googleConfig, apiKey: e.target.value})}
                              className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm font-mono text-slate-400"
                            />
                          </div>
                      </div>
                    </div>
                </div>

                <div className="mt-8 pt-6 border-t border-slate-800 flex justify-end">
                  <button 
                    onClick={() => setShowSettings(false)}
                    className="w-full sm:w-auto bg-slate-700 hover:bg-slate-600 text-white px-8 py-3 rounded-lg text-sm font-medium transition-colors shadow-lg hover:shadow-slate-700/50"
                  >
                    Salvar e Fechar
                  </button>
                </div>
             </div>
          </div>
        )}

        {/* Workspace Grid - RESPONSIVE LAYOUT CHANGE */}
        {/* Mobile: Flex Column (Stacked) | Desktop: Grid 12 cols */}
        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6 h-auto lg:h-[600px]">
          
          {/* Left: Source */}
          <div className="lg:col-span-4 h-[400px] lg:h-full flex flex-col gap-3">
             <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-slate-300 font-medium text-sm">Origem</h2>
                  {googleConfig.accessToken ? (
                    <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full border border-green-500/30">
                      Conectado
                    </span>
                  ) : (
                    <span className="text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">Off</span>
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
                emptyMessage={!googleConfig.accessToken ? "Faça login para listar" : "Nenhum arquivo encontrado"}
             />
          </div>

          {/* Center: Controls & Status */}
          <div className="lg:col-span-4 h-auto lg:h-full flex flex-col gap-4 order-last lg:order-none">
            {/* Control Panel */}
            <div className="flex-none bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6 shadow-lg flex flex-col items-center justify-center text-center space-y-4">
              <div className="p-3 sm:p-4 bg-slate-800/50 rounded-full">
                <ArrowRight className={`w-6 h-6 sm:w-8 sm:h-8 text-slate-400 ${isTransferring ? 'animate-pulse text-blue-400' : ''} rotate-90 lg:rotate-0`} />
              </div>
              
              <button
                onClick={handleStartMigration}
                disabled={isTransferring || sourceFiles.length === 0}
                className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-bold text-white text-sm sm:text-base transition-all transform active:scale-95
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
            <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col min-h-[250px] lg:min-h-0">
              <div className="p-3 border-b border-slate-800 bg-slate-800/50 text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Fila de Transferência
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {transferQueue.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-2 opacity-50 p-4">
                    <Cloud className="w-8 h-8" />
                    <span className="text-xs text-center">Os arquivos aparecerão aqui durante a migração.</span>
                  </div>
                ) : (
                  transferQueue.map((item, idx) => (
                    <div key={idx} className="bg-slate-950 p-3 rounded border border-slate-800 text-xs">
                      <div className="flex justify-between items-center mb-2">
                        <span className="truncate text-slate-300 max-w-[150px] font-medium">{item.file.name}</span>
                        <div className="flex items-center gap-2">
                            {item.status === TransferStatus.COMPLETED && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                            {item.status === TransferStatus.ERROR && <AlertCircle className="w-4 h-4 text-red-500" />}
                            {item.status === TransferStatus.IN_PROGRESS && <span className="text-blue-400 font-mono">{Math.round(item.progress)}%</span>}
                            {item.status === TransferStatus.PENDING && <span className="text-slate-600">...</span>}
                        </div>
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
          <div className="lg:col-span-4 h-[400px] lg:h-full flex flex-col gap-3">
             <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1 truncate max-w-[200px]">
                  <h2 className="text-slate-300 font-medium text-sm">Destino</h2>
                  {azureConfig.containerName && <span className="text-[10px] text-slate-500 truncate">({azureConfig.containerName})</span>}
                </div>
                <button onClick={handleFetchDest} disabled={loadingDest || isTransferring} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 shrink-0">
                  <RefreshCw className={`w-3 h-3 ${loadingDest ? 'animate-spin' : ''}`} /> Atualizar
                </button>
             </div>
             <FileTable 
                title="Azure Blob Storage" 
                icon={<Server className="w-5 h-5 text-blue-500" />} 
                files={destFiles} 
                isLoading={loadingDest}
                emptyMessage={containerNotFound ? "Contêiner não existe. Crie-o." : !azureConfig.containerName ? "Configure um contêiner" : "Pasta vazia"}
             />
          </div>
        </div>

        {/* Bottom: Console (Expanded) */}
        <div className="h-64">
           {/* Terminal */}
           <div className="w-full h-full bg-slate-950 border border-slate-800 rounded-xl flex flex-col font-mono text-xs overflow-hidden shadow-inner">
             <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center gap-2 text-slate-400">
               <Terminal className="w-4 h-4" />
               <span>Log de Operações do Sistema</span>
             </div>
             <div className="flex-1 overflow-y-auto p-4 space-y-1">
                {logs.length === 0 && <div className="text-slate-600 italic">Sistema inicializado. Aguardando comandos.</div>}
                {logs.map((log, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-slate-500 shrink-0">[{log.timestamp}]</span>
                    <span className={`shrink-0 font-bold
                      ${log.level === 'ERROR' ? 'text-red-400' : ''}
                      ${log.level === 'SUCCESS' ? 'text-green-400' : ''}
                      ${log.level === 'WARNING' ? 'text-yellow-400' : ''}
                      ${log.level === 'INFO' ? 'text-blue-200' : ''}
                    `}>
                      {log.level}:
                    </span>
                    <span className="text-slate-300 break-words">{log.message}</span>
                  </div>
                ))}
                <div ref={logsEndRef} />
             </div>
           </div>
        </div>

      </main>
    </div>
  );
}