import { CloudFile, AzureConfig } from '../types';

// Helper to construct the base URL
const getContainerUrl = (config: AzureConfig) => {
  return `https://${config.accountName}.blob.core.windows.net/${config.containerName}`;
};

export const listBlobs = async (config: AzureConfig): Promise<CloudFile[]> => {
  if (!config.containerName) throw new Error("Nome do contêiner não fornecido");

  try {
    const url = `${getContainerUrl(config)}?restype=container&comp=list&${config.sasToken}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/xml'
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Contêiner '${config.containerName}' não encontrado (404). Crie-o no Azure Portal.`);
      }
      throw new Error(`Falha na listagem do Azure: ${response.statusText} (${response.status})`);
    }

    const text = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, "text/xml");
    const blobs = xmlDoc.getElementsByTagName("Blob");
    
    const files: CloudFile[] = [];
    
    for (let i = 0; i < blobs.length; i++) {
      const name = blobs[i].getElementsByTagName("Name")[0]?.textContent || "desconhecido";
      const props = blobs[i].getElementsByTagName("Properties")[0];
      const size = parseInt(props?.getElementsByTagName("Content-Length")[0]?.textContent || "0");
      const lastModified = props?.getElementsByTagName("Last-Modified")[0]?.textContent || new Date().toISOString();
      const contentType = props?.getElementsByTagName("Content-Type")[0]?.textContent || "application/octet-stream";

      files.push({
        id: name,
        name: name,
        size: size,
        mimeType: contentType,
        lastModified: lastModified
      });
    }
    
    return files;

  } catch (error) {
    console.error("Erro ao listar blobs:", error);
    throw error;
  }
};

export const uploadBlob = async (
  file: CloudFile, 
  config: AzureConfig, 
  onProgress: (progress: number) => void
): Promise<string> => {
  const url = `${getContainerUrl(config)}/${encodeURIComponent(file.name)}?${config.sasToken}`;
  
  // Create a mock blob if we don't have real file content (since this is a frontend demo simulating drive)
  const content = file.content instanceof Blob ? file.content : new Blob([file.content || "Conteúdo simulado para " + file.name], { type: file.mimeType });

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    
    // Azure Blob Storage specific headers
    xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
    xhr.setRequestHeader('x-ms-date', new Date().toUTCString());
    xhr.setRequestHeader('Content-Type', file.mimeType);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percentComplete = (e.loaded / e.total) * 100;
        onProgress(percentComplete);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(url); // Return the URL of the uploaded blob (without SAS for display security)
      } else {
        if (xhr.status === 404) {
          reject(new Error("Contêiner de destino não encontrado no Azure (Erro 404)."));
        } else {
          reject(new Error(`Falha no upload: ${xhr.status} ${xhr.statusText}`));
        }
      }
    };

    xhr.onerror = () => {
      reject(new Error("Erro de rede durante o upload. Verifique CORS e conexão."));
    };

    xhr.send(content);
  });
};