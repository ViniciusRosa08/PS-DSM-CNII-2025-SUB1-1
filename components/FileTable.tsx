import React from 'react';
import { CloudFile } from '../types';
import { FileIcon, FileText, Database, Image, Code } from 'lucide-react';

interface FileTableProps {
  files: CloudFile[];
  title: string;
  icon: React.ReactNode;
  isLoading: boolean;
  emptyMessage?: string;
}

const getFileIcon = (mimeType: string) => {
  if (mimeType.includes('image')) return <Image className="w-4 h-4 text-purple-400" />;
  if (mimeType.includes('pdf')) return <FileText className="w-4 h-4 text-red-400" />;
  if (mimeType.includes('sql') || mimeType.includes('database')) return <Database className="w-4 h-4 text-blue-400" />;
  if (mimeType.includes('text') || mimeType.includes('sh')) return <Code className="w-4 h-4 text-green-400" />;
  return <FileIcon className="w-4 h-4 text-gray-400" />;
};

const formatSize = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const FileTable: React.FC<FileTableProps> = ({ files, title, icon, isLoading, emptyMessage }) => {
  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
      {/* Header */}
      <div className="p-3 sm:p-4 bg-slate-800/50 border-b border-slate-700 flex items-center justify-between backdrop-blur-sm">
        <div className="flex items-center space-x-2 font-semibold text-slate-100 truncate">
          <div className="shrink-0">{icon}</div>
          <span className="truncate text-sm sm:text-base">{title}</span>
        </div>
        <span className="text-[10px] sm:text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded-full shrink-0">
          {files.length} <span className="hidden sm:inline">itens</span>
        </span>
      </div>
      
      {/* Table Content */}
      <div className="flex-1 overflow-y-auto min-h-[200px]">
        {isLoading ? (
          <div className="flex items-center justify-center h-full min-h-[150px]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        ) : files.length === 0 ? (
          <div className="h-full min-h-[150px] flex items-center justify-center p-8 text-center text-slate-500 text-xs sm:text-sm italic">
            {emptyMessage || "Nenhum arquivo encontrado."}
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-800/30 text-[10px] sm:text-xs uppercase text-slate-400 sticky top-0 backdrop-blur-md z-10">
              <tr>
                <th className="p-2 sm:p-3 font-medium">Nome</th>
                <th className="p-2 sm:p-3 font-medium text-right w-20 sm:w-24">Tamanho</th>
                {/* Hidden on mobile */}
                <th className="p-3 font-medium text-right hidden md:table-cell w-32">Modificado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-xs sm:text-sm">
              {files.map((file, idx) => (
                <tr key={idx} className="hover:bg-slate-800/50 transition-colors">
                  <td className="p-2 sm:p-3">
                    <div className="flex items-center space-x-2 sm:space-x-3">
                      <div className="shrink-0">{getFileIcon(file.mimeType)}</div>
                      <span className="text-slate-200 truncate max-w-[120px] sm:max-w-[160px] md:max-w-xs lg:max-w-[140px] xl:max-w-xs" title={file.name}>
                        {file.name}
                      </span>
                    </div>
                  </td>
                  <td className="p-2 sm:p-3 text-right text-slate-400 font-mono text-[10px] sm:text-xs whitespace-nowrap">
                    {formatSize(file.size)}
                  </td>
                  <td className="p-3 text-right text-slate-500 text-xs hidden md:table-cell whitespace-nowrap">
                    {new Date(file.lastModified).toLocaleDateString('pt-BR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};