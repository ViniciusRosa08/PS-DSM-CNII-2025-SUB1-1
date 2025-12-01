import { CloudFile } from '../types';

/**
 * Lista arquivos do Google Drive usando a API REST v3.
 * Requer um Access Token válido obtido via OAuth 2.0.
 */
export const listDriveFiles = async (accessToken: string, apiKey: string): Promise<CloudFile[]> => {
  if (!accessToken) throw new Error("Token de acesso não fornecido.");

  // Query para listar arquivos que não são lixeira e são arquivos (não pastas, para simplificar)
  // 'q': "trashed = false and mimeType != 'application/vnd.google-apps.folder'",
  const query = "trashed = false and not mimeType = 'application/vnd.google-apps.folder'";
  const fields = "files(id, name, mimeType, size, modifiedTime)";
  
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&key=${apiKey}&pageSize=20`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Erro Google API: ${errorData.error?.message || response.statusText}`);
  }

  const data = await response.json();

  if (!data.files) return [];

  return data.files.map((f: any) => ({
    id: f.id,
    name: f.name,
    // Google Docs (Docs, Sheets, etc) não retornam size. Assumimos 0 ou tratamos depois.
    size: f.size ? parseInt(f.size) : 0, 
    mimeType: f.mimeType,
    lastModified: f.modifiedTime
  }));
};

/**
 * Baixa o conteúdo de um arquivo do Google Drive.
 * Para arquivos nativos do Google (Docs, Sheets), precisaria exportar.
 * Para arquivos binários (PDF, Imagens), usa alt=media.
 */
export const downloadDriveFile = async (fileId: string, accessToken: string, apiKey: string, mimeType: string): Promise<Blob> => {
  let url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey}`;
  
  // Tratamento básico para arquivos nativos do Google Workspace (Exportação)
  if (mimeType.includes('application/vnd.google-apps')) {
     // Exemplo: Converter Google Doc para PDF
     if (mimeType.includes('document')) {
        url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf&key=${apiKey}`;
     } else if (mimeType.includes('spreadsheet')) {
        url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet&key=${apiKey}`;
     } else {
        throw new Error("Exportação deste tipo de arquivo Google Docs não implementada nesta demo.");
     }
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Erro ao baixar arquivo: ${response.statusText}`);
  }

  return await response.blob();
};