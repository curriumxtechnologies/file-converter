// Configuration - Auto-detect API URL
const API_BASE_URL = (() => {
    // Check if we're in production (Vercel)
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        // Use the Render backend URL
        // REPLACE THIS with your actual Render URL after deployment
        return 'https://heic-converter-api.onrender.com';
    }
    // Development
    return 'http://127.0.0.1:8000';
})();

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const BULK_DOWNLOAD_THRESHOLD = 5;

console.log(`🔧 API: ${API_BASE_URL}`);

// State Management
class AppState {
    constructor() {
        this.files = new Map();
        this.listeners = new Set();
        this.batchZipBlob = null;
    }

    addFile(file) {
        const id = this.generateFileId(file);
        this.files.set(id, {
            id,
            file,
            status: 'pending',
            progress: 0,
            originalSize: file.size,
            convertedSize: null,
            error: null,
            convertedBlob: null,
            convertedName: null
        });
        this.notify();
        return id;
    }

    updateFile(id, updates) {
        const fileData = this.files.get(id);
        if (fileData) {
            Object.assign(fileData, updates);
            this.notify();
        }
    }

    removeFile(id) {
        this.files.delete(id);
        this.notify();
    }

    clearAll() {
        this.files.clear();
        this.batchZipBlob = null;
        this.notify();
    }

    getFile(id) { return this.files.get(id); }
    getAllFiles() { return Array.from(this.files.values()); }
    getPendingFiles() { return this.getAllFiles().filter(f => f.status === 'pending'); }
    getSuccessFiles() { return this.getAllFiles().filter(f => f.status === 'success'); }
    
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify() {
        this.listeners.forEach(listener => listener(this.getAllFiles()));
    }

    generateFileId(file) {
        return `${file.name}-${file.size}-${file.lastModified}`;
    }
}

// API Client
class ApiClient {
    static async uploadFiles(files) {
        const formData = new FormData();
        files.forEach(f => formData.append('files', f.file));

        console.log(`📤 Uploading ${files.length} files to ${API_BASE_URL}/convert`);

        const response = await fetch(`${API_BASE_URL}/convert`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || `Upload failed (${response.status})`);
        }

        const contentType = response.headers.get('Content-Type');
        const contentDisposition = response.headers.get('Content-Disposition');
        const blob = await response.blob();

        if (contentType === 'application/zip') {
            let filename = 'converted_images.zip';
            if (contentDisposition) {
                const match = contentDisposition.match(/filename="(.+)"/);
                if (match) filename = match[1];
            }
            return { type: 'zip', blob, filename };
        } else {
            let filename = 'converted.png';
            if (contentDisposition) {
                const match = contentDisposition.match(/filename="(.+)"/);
                if (match) filename = match[1];
            }
            return { type: 'single', blob, filename };
        }
    }

    static async getStats() {
        try {
            const res = await fetch(`${API_BASE_URL}/stats`);
            if (res.ok) return await res.json();
        } catch (e) {
            console.warn('Stats unavailable');
        }
        return null;
    }
}

// UI Manager
class UIManager {
    constructor(state) {
        this.state = state;
        this.elements = this.cacheElements();
        this.initEventListeners();
        this.state.subscribe(this.render.bind(this));
        this.loadStats();
        setInterval(() => this.loadStats(), 30000);
    }

    cacheElements() {
        return {
            uploadZone: document.getElementById('uploadZone'),
            fileInput: document.getElementById('fileInput'),
            filesSection: document.getElementById('filesSection'),
            filesGrid: document.getElementById('filesGrid'),
            fileCount: document.getElementById('fileCount'),
            clearAllBtn: document.getElementById('clearAllBtn'),
            convertBtn: document.getElementById('convertBtn'),
            errorSection: document.getElementById('errorSection'),
            errorMessage: document.getElementById('errorMessage'),
            errorCloseBtn: document.getElementById('errorCloseBtn'),
            todayCount: document.getElementById('todayCount'),
            downloadAllSection: document.getElementById('downloadAllSection')
        };
    }

    initEventListeners() {
        this.elements.uploadZone.addEventListener('click', () => this.elements.fileInput.click());
        this.elements.fileInput.addEventListener('change', (e) => {
            this.handleFileSelect(e.target.files);
            e.target.value = '';
        });

        ['dragover', 'dragleave', 'drop'].forEach(evt => {
            this.elements.uploadZone.addEventListener(evt, (e) => {
                e.preventDefault();
                if (evt === 'dragover') this.elements.uploadZone.classList.add('drag-over');
                if (evt === 'dragleave') this.elements.uploadZone.classList.remove('drag-over');
                if (evt === 'drop') {
                    this.elements.uploadZone.classList.remove('drag-over');
                    this.handleFileSelect(e.dataTransfer.files);
                }
            });
        });

        this.elements.clearAllBtn.addEventListener('click', () => {
            if (this.state.getAllFiles().length > 0 && confirm('Clear all files?')) {
                this.state.clearAll();
            }
        });

        this.elements.convertBtn.addEventListener('click', () => this.handleConvert());
        this.elements.errorCloseBtn.addEventListener('click', () => this.hideError());

        document.addEventListener('dragover', e => e.preventDefault());
        document.addEventListener('drop', e => e.preventDefault());
    }

    handleFileSelect(fileList) {
        const heicFiles = Array.from(fileList).filter(f => {
            const ext = f.name.split('.').pop()?.toLowerCase();
            return ext === 'heic' || ext === 'heif';
        });

        if (!heicFiles.length) {
            this.showError('Please select HEIC/HEIF files only.');
            return;
        }

        const oversized = heicFiles.filter(f => f.size > MAX_FILE_SIZE);
        if (oversized.length) {
            this.showError(`Files exceeding 50MB: ${oversized.map(f => f.name).join(', ')}`);
        }

        heicFiles.filter(f => f.size <= MAX_FILE_SIZE).forEach(f => this.state.addFile(f));
        this.hideError();
    }

    async handleConvert() {
        const pending = this.state.getPendingFiles();
        if (!pending.length) return;

        this.elements.convertBtn.disabled = true;
        this.elements.convertBtn.innerHTML = '<span class="spinner"></span> Converting...';
        
        pending.forEach(f => this.state.updateFile(f.id, { status: 'converting', progress: 50 }));

        try {
            const result = await ApiClient.uploadFiles(pending);
            
            if (result.type === 'single') {
                this.state.updateFile(pending[0].id, {
                    status: 'success', progress: 100,
                    convertedBlob: result.blob,
                    convertedName: result.filename,
                    convertedSize: result.blob.size
                });
                setTimeout(() => this.downloadBlob(result.blob, result.filename), 500);
            } else {
                this.state.batchZipBlob = result.blob;
                pending.forEach(f => {
                    this.state.updateFile(f.id, {
                        status: 'success', progress: 100,
                        convertedBlob: result.blob,
                        convertedName: result.filename,
                        convertedSize: result.blob.size
                    });
                });
                if (pending.length > BULK_DOWNLOAD_THRESHOLD) {
                    setTimeout(() => this.downloadBlob(result.blob, result.filename), 800);
                }
            }
            
            this.hideError();
            this.loadStats();
        } catch (error) {
            pending.forEach(f => this.state.updateFile(f.id, {
                status: 'error', progress: 100, error: error.message
            }));
            this.showError(error.message);
        } finally {
            this.elements.convertBtn.disabled = false;
            this.elements.convertBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Convert All
            `;
        }
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    downloadAllAsZip() {
        if (this.state.batchZipBlob) {
            this.downloadBlob(this.state.batchZipBlob, 
                `converted_${this.state.getSuccessFiles().length}_images.zip`);
        }
    }

    showError(msg) {
        this.elements.errorMessage.textContent = msg;
        this.elements.errorSection.style.display = 'block';
        setTimeout(() => this.hideError(), 8000);
    }

    hideError() {
        this.elements.errorSection.style.display = 'none';
    }

    async loadStats() {
        const stats = await ApiClient.getStats();
        if (stats) {
            this.elements.todayCount.textContent = stats.conversions_today || 0;
        }
    }

    formatFileSize(bytes) {
        if (!bytes) return '0 Bytes';
        const units = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
    }

    render(files) {
        if (files.length > 0) {
            this.elements.filesSection.style.display = 'block';
            this.elements.fileCount.textContent = files.length;
        } else {
            this.elements.filesSection.style.display = 'none';
        }

        this.elements.filesGrid.innerHTML = files.map(f => this.renderFileItem(f)).join('');

        files.forEach(f => {
            const dBtn = document.getElementById(`dl-${f.id}`);
            if (dBtn) dBtn.onclick = () => this.downloadBlob(f.convertedBlob, f.convertedName);
            const rBtn = document.getElementById(`rm-${f.id}`);
            if (rBtn) rBtn.onclick = () => this.state.removeFile(f.id);
        });

        const successCount = files.filter(f => f.status === 'success').length;
        if (successCount > 0 && this.state.batchZipBlob) {
            this.elements.downloadAllSection.innerHTML = `
                <div class="bulk-download-card">
                    <div>
                        <strong>📦 Batch Download Ready</strong>
                        <p>${successCount} files converted</p>
                    </div>
                    <button class="btn btn-primary btn-large" id="downloadAllBtn">
                        Download All as ZIP
                    </button>
                </div>`;
            this.elements.downloadAllSection.classList.remove('hidden');
            document.getElementById('downloadAllBtn').onclick = () => this.downloadAllAsZip();
        } else {
            this.elements.downloadAllSection.classList.add('hidden');
        }

        const hasPending = files.some(f => f.status === 'pending');
        this.elements.convertBtn.disabled = !hasPending;
    }

    renderFileItem(f) {
        const icons = { pending: '📄', converting: '⚙️', success: '✅', error: '❌' };
        const labels = { pending: 'Ready', converting: 'Converting...', success: 'Done', error: 'Failed' };
        const width = f.status === 'converting' ? '50%' : f.status !== 'pending' ? '100%' : '0%';
        
        let action = '';
        if (f.status === 'success' && this.state.getSuccessFiles().length <= BULK_DOWNLOAD_THRESHOLD) {
            action = `<button class="btn btn-primary btn-small" id="dl-${f.id}">Download</button>`;
        } else if (f.status === 'success') {
            action = '<span class="badge badge-success">In ZIP</span>';
        } else if (f.status === 'error') {
            action = `<button class="btn btn-secondary btn-small" id="rm-${f.id}">✕</button>`;
        } else if (f.status === 'converting') {
            action = '<span class="spinner"></span>';
        }

        return `
            <div class="file-item status-${f.status}">
                <div class="file-icon">${icons[f.status]}</div>
                <div class="file-info">
                    <div class="file-name">${this.escapeHtml(f.file.name)}</div>
                    <div class="file-meta">
                        <span>${this.formatFileSize(f.originalSize)}</span>
                        ${f.convertedSize ? `<span>→ ${this.formatFileSize(f.convertedSize)}</span>` : ''}
                        <span class="file-status ${f.status}">${labels[f.status]}</span>
                    </div>
                    ${f.status !== 'pending' ? `<div class="file-progress"><div class="file-progress-bar" style="width:${width}"></div></div>` : ''}
                </div>
                <div class="file-actions">${action}</div>
            </div>`;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    new UIManager(new AppState());
});