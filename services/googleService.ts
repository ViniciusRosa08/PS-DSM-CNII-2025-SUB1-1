import { CloudFile } from '../types';

/**
 * Lista arquivos do Google Drive.
 */
export const listDriveFiles = async (accessToken: string | undefined, apiKey: string): Promise<CloudFile[]> => {
  
  if (!accessToken) throw new Error("Token de acesso não fornecido. Faça login.");

  // Query: Não deletados, não pastas.
  const query = "trashed = false and not mimeType = 'application/vnd.google-apps.folder'";
  const fields = "files(id, name, mimeType, size, modifiedTime)";
  
  // Para LISTAGEM, usamos a API Key na URL se disponível, mas o Token no Header é o principal
  let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&pageSize=30`;
  if (apiKey) url += `&key=${apiKey}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData.error?.message || response.statusText;
    
    // Tratamento específico para token expirado
    if (response.status === 401) {
      throw new Error(`Sessão expirada (401). Faça login novamente.`);
    }
    
    throw new Error(`Erro Google API (${response.status}): ${errorMessage}`);
  }

  const data = await response.json();

  if (!data.files) return [];

  return data.files.map((f: any) => ({
    id: f.id,
    name: f.name,
    size: f.size ? parseInt(f.size) : 0, 
    mimeType: f.mimeType,
    lastModified: f.modifiedTime
  }));
};

/**
 * Baixa o conteúdo de um arquivo.
 * Realiza a conversão (exportação) automática de arquivos Workspace.
 */
export const downloadDriveFile = async (fileId: string, accessToken: string | undefined, apiKey: string, mimeType: string): Promise<Blob> => {
  
  if (!accessToken) throw new Error("Token de autenticação (OAuth) é obrigatório para download.");

  let url = '';
  
  // --- LÓGICA DE EXPORTAÇÃO WORKSPACE ---
  // Arquivos nativos do Google (Docs, Sheets) DEVEM usar /export e NÃO aceitam API Key na URL junto com token
  
  if (mimeType.includes('application/vnd.google-apps')) {
     let exportMimeType = '';
     
     if (mimeType.includes('document')) {
        exportMimeType = 'application/pdf';
     } else if (mimeType.includes('spreadsheet')) {
        exportMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; // XLSX
     } else if (mimeType.includes('presentation')) {
        exportMimeType = 'application/pdf'; 
     } else if (mimeType.includes('script') || mimeType.includes('json')) {
        exportMimeType = 'application/json';
     } else {
        exportMimeType = 'application/pdf'; // Fallback seguro
     }

     // Endpoint de exportação
     url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${exportMimeType}`;
  } else {
      // Arquivos binários normais (PDF, JPG, ZIP enviados pelo usuário)
      // Endpoint de mídia direta
      url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  }

  // IMPORTANTE: Não anexamos &key=${apiKey} aqui para evitar conflito "Request had invalid authentication credentials"
  // O Google Drive API prefere apenas o Header Authorization para downloads de mídia/exportação.

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const msg = errorData.error?.message || response.statusText;
    throw new Error(`Erro Download Google (${response.status}): ${msg}`);
  }

  return await response.blob();
};