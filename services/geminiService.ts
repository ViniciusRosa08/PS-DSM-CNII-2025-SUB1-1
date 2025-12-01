import { GoogleGenAI } from "@google/genai";
import { LogEntry } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const analyzeMigrationLogs = async (logs: LogEntry[]): Promise<string> => {
  try {
    const errorLogs = logs.filter(l => l.level === 'ERROR' || l.level === 'WARNING');
    const successLogs = logs.filter(l => l.level === 'SUCCESS');
    
    const summary = `
      Resumo da Migração:
      - Total com Sucesso: ${successLogs.length}
      - Total com Erros/Avisos: ${errorLogs.length}
      
      Detalhes dos erros:
      ${JSON.stringify(errorLogs.slice(0, 10))}
    `;

    const model = 'gemini-2.5-flash';
    const response = await ai.models.generateContent({
      model: model,
      contents: `Você é um Engenheiro DevOps Sênior. Analise este resumo de log de migração. 
      Explique brevemente o que pode ter dado errado (se houver erros) e sugira correções. 
      Se estiver tudo bem, dê um feedback positivo e uma breve avaliação de desempenho.
      
      IMPORTANTE: Responda APENAS em Português do Brasil.
      
      Dados do Log:
      ${summary}`,
    });

    return response.text || "Análise completa. Nenhum insight gerado.";
  } catch (error) {
    console.error("Falha na análise do Gemini:", error);
    return "Não foi possível analisar os logs no momento. Verifique sua chave de API.";
  }
};