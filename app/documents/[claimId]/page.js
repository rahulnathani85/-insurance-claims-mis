'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';

export default function DocumentManagement() {
  const params = useParams();
  const router = useRouter();
  const claimId = params.claimId;

  const [claim, setClaim] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [alert, setAlert] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    loadClaimAndDocuments();
  }, [claimId]);

  async function loadClaimAndDocuments() {
    try {
      setLoading(true);
      const [claimRes, docsRes] = await Promise.all([
        fetch(`/api/claims/${claimId}`).then(r => r.json()),
        fetch(`/api/documents/${claimId}`).then(r => r.json()),
      ]);
      setClaim(claimRes);
      setDocuments(Array.isArray(docsRes) ? docsRes : []);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }

  function showAlert(msg, type) {
    setAlert({ msg, type });
    setTimeout(() => setAlert(null), 5000);
  }

  async function handleFileUpload(files) {
    if (files.length === 0) return;

    try {
      setUploading(true);
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('claim_id', claimId);
        formData.append('document_name', file.name);

        const res = await fetch('/api/documents', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) throw new Error('Upload failed');
      }
      showAlert(`${files.length} file(s) uploaded successfully`, 'success');
      await loadClaimAndDocuments();
    } catch (e) {
      showAlert('Upload failed: ' + e.message, 'error');
    } finally {
      setUploading(false);
    }
  }

  async function deleteDocument(docId) {
    if (!confirm('Delete this document?')) return;
    try {
      const res = await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      showAlert('Document deleted', 'success');
      await loadClaimAndDocuments();
    } catch (e) {
      showAlert('Delete failed: ' + e.message, 'error');
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setDragOver(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    handleFileUpload(files);
  }

  return (
    <PageLayout>
      <div className="main-content">
        {alert && <div className={`alert ${alert.type}`}>{alert.msg}</div>}
        <h2>Document Management</h2>

        {loading ? (
          <div className="loading">Loading claim details...</div>
        ) : claim ? (
          <>
            <div className="form-section">
              <h4>Claim Information</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <div style={{ marginBottom: 10 }}>
                    <strong>Ref Number:</strong> {claim.ref_number || '-'}
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <strong>Insured Name:</strong> {claim.insured_name || '-'}
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <strong>LOB:</strong> {claim.lob || '-'}
                  </div>
                </div>
                <div>
                  <div style={{ marginBottom: 10 }}>
                    <strong>Claim Number:</strong> {claim.claim_number || '-'}
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <strong>Insurer:</strong> {claim.insurer_name || '-'}
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <strong>Status:</strong> <span className={`badge ${claim.status.toLowerCase().replace(/\s+/g, '-')}`}>{claim.status}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="form-section">
              <h4>Upload Documents</h4>
              <div
                className={`upload-area ${dragOver ? 'dragover' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => document.getElementById('fileInput').click()}
                style={{ cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1 }}
              >
                <div style={{ fontSize: 32, marginBottom: 10 }}>📄</div>
                <p>Drag and drop documents here or click to select</p>
                <p style={{ fontSize: 12, color: '#999', marginTop: 5 }}>Supported formats: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG</p>
              </div>
              <input
                id="fileInput"
                type="file"
                multiple
                onChange={e => handleFileUpload(Array.from(e.target.files))}
                style={{ display: 'none' }}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
              />
            </div>

            <div className="form-section">
              <h4>Documents ({documents.length})</h4>
              {documents.length === 0 ? (
                <p style={{ color: '#999', textAlign: 'center', padding: 20 }}>No documents uploaded yet</p>
              ) : (
                <div className="document-list">
                  {documents.map(doc => (
                    <div key={doc.id} className="document-item">
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500 }}>{doc.document_name || 'Unnamed'}</div>
                        <div style={{ fontSize: 12, color: '#666', marginTop: 3 }}>
                          Uploaded: {new Date(doc.uploaded_at).toLocaleDateString('en-IN')}
                          {doc.file_size && ` | Size: ${(doc.file_size / 1024).toFixed(2)} KB`}
                        </div>
                      </div>
                      <div className="action-buttons">
                        {doc.file_url && (
                          <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="btn" style={{ padding: '6px 12px', fontSize: 12 }}>
                            Download
                          </a>
                        )}
                        <button className="danger" onClick={() => deleteDocument(doc.id)} style={{ padding: '6px 12px', fontSize: 12 }}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginTop: 30 }}>
              <button className="secondary" onClick={() => router.back()}>Back</button>
            </div>
          </>
        ) : (
          <div className="alert error">Claim not found</div>
        )}
      </div>
    </PageLayout>
  );
}
