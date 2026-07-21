
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Copy } from 'lucide-react';
import { data as dataClient } from '@/lib/data';
import type { AppSession, ApiKey } from '@/lib/data';
import { useToast } from './Toast';
import { ViewportAwareDialog } from './ViewportAwareDialog';
import ConfirmActionDialog from './ConfirmActionDialog';

interface ApiKeyManagerProps {
  session: AppSession;
  onViewDocs: () => void;
}

const ApiKeyManager: React.FC<ApiKeyManagerProps> = ({ session, onViewDocs }) => {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null);
  const { addToast } = useToast();
  // Guards setState if the user leaves the Settings tab while a key call is in flight.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    const { data, error } = await dataClient.apiKeys.list(session.user.id);
    if (!mountedRef.current) return;

    if (error) {
      // Don't pop a toast on the automatic load — a transient first-render error
      // would flash a notification. Show an inline message instead.
      console.error('Failed to fetch API keys:', error.message);
      setFetchError(true);
    } else {
      setKeys(data ?? []);
      setFetchError(false);
    }
    setLoading(false);
  }, [session.user.id]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) {
      addToast('Please provide a name for your key.', 'error');
      return;
    }
    setLoading(true);
    const { data, error } = await dataClient.apiKeys.create(session.user.id, newKeyName.trim());
    if (!mountedRef.current) return;

    if (error) {
      addToast(`Failed to create key: ${error.message}`, 'error');
    } else {
      setGeneratedKey(data);
      addToast('API key created successfully!', 'success');
      setNewKeyName('');
      fetchKeys();
    }
    setLoading(false);
  };

  const handleDeleteKey = async (key: ApiKey) => {
    setLoading(true);
    const { error } = await dataClient.apiKeys.remove(key.id, session.user.id);
    if (!mountedRef.current) return;

    if (error) {
      addToast(`Failed to delete key: ${error.message}`, 'error');
    } else {
      setDeleteTarget(null);
      addToast('API key deleted.', 'success');
      fetchKeys();
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Generate API keys to integrate Career CoPilot's features into your own applications. Refer to the <button type="button" onClick={onViewDocs} className="text-blue-600 dark:text-blue-400 hover:underline font-semibold">API documentation</button> for usage details.
      </p>
      
      {generatedKey && (
          <ViewportAwareDialog open onClose={() => setGeneratedKey(null)} closeOnBackdrop labelledBy="generated-api-key-title" maxWidth={448} zIndex={80}>
              <div className="rounded-lg bg-white p-6 shadow-xl dark:bg-slate-800">
                  <h3 id="generated-api-key-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">Your New API Key</h3>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-md my-4">
                      Please copy your new API key now. You won’t be able to see it again!
                  </p>
                  <div className="relative">
                      <input
                          readOnly
                          value={generatedKey}
                          className="w-full bg-gray-100 dark:bg-slate-900/50 p-3 rounded-md font-mono text-sm border border-gray-300 dark:border-slate-600"
                      />
                      <button type="button"
                          onClick={() => { navigator.clipboard.writeText(generatedKey); addToast('Key copied!', 'success'); }} 
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-gray-500 transition hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400/40"
                          aria-label="Copy API Key"
                      >
                          <Copy className="h-5 w-5" aria-hidden="true" />
                      </button>
                  </div>
                  <button type="button" onClick={() => setGeneratedKey(null)} className="mt-4 w-full bg-blue-600 text-white font-semibold py-2 rounded-md hover:bg-blue-700">
                      I have copied my key
                  </button>
              </div>
          </ViewportAwareDialog>
      )}
      
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          placeholder="Enter a name for your key..."
          className="flex-grow border border-gray-300 dark:border-slate-600 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-slate-900"
          disabled={loading}
        />
        <button type="button" onClick={handleCreateKey} disabled={loading || !newKeyName.trim()} className="px-4 py-2 bg-gray-800 text-white font-semibold rounded-md shadow-sm hover:bg-black disabled:bg-gray-400">
          {loading ? 'Creating...' : 'Create New Key'}
        </button>
      </div>
      
      <div className="space-y-4">
        {keys.map(key => (
          <div key={key.id} className="p-4 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <p className="font-bold text-gray-800 dark:text-gray-100">{key.key_name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-1">
                Created: {new Date(key.created_at).toLocaleDateString()} | Last used: {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}
              </p>
            </div>
            <button type="button" onClick={() => setDeleteTarget(key)} disabled={loading} className="text-sm text-red-600 hover:text-red-800 font-semibold disabled:opacity-50">
              Delete
            </button>
          </div>
        ))}
        {loading && !keys.length && <p className="text-sm text-gray-500">Loading keys...</p>}
        {!loading && fetchError && (
          <div className="flex items-center justify-between gap-3 text-sm text-red-600 dark:text-red-400">
            <span>Couldn't load your API keys.</span>
            <button type="button" onClick={fetchKeys} className="font-semibold hover:underline">Retry</button>
          </div>
        )}
        {!loading && !fetchError && keys.length === 0 && <p className="text-sm text-gray-500">You have no API keys yet.</p>}
      </div>
      <ConfirmActionDialog
        open={Boolean(deleteTarget)}
        title="Delete API key"
        description="This key will stop working immediately. This action cannot be undone."
        detail={deleteTarget?.key_name}
        cancelLabel="Cancel"
        confirmLabel="Delete key"
        loadingLabel="Deleting..."
        loading={Boolean(deleteTarget && loading)}
        tone="danger"
        onOpenChange={(open) => {
          if (!open && !loading) setDeleteTarget(null);
        }}
        onCancel={() => {
          if (!loading) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (deleteTarget) void handleDeleteKey(deleteTarget);
        }}
      />
    </div>
  );
};

export default ApiKeyManager;
