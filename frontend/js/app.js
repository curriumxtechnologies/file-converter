// Configuration
const API_BASE_URL = (() => {
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        return 'https://file-converter-api-iks5.onrender.com';
    }
    return 'http://127.0.0.1:8000';
})();

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const BULK_DOWNLOAD_THRESHOLD = 5;

console.log(`🔧 API: ${API_BASE_URL}`);
console.log(`📦 Bulk download: ${BULK_DOWNLOAD_THRESHOLD}+ files = ZIP`);

// ============================================================================
// State Management
// ============================================================================
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

// ============================================================================
// API Client - Optimized for Render Free Tier
// ============================================================================
class ApiClient {
    // Force HTTP/1.1 to avoid QUIC protocol issues on Render
    static async fetchWithRetry(url, options = {}, retries = 5) {
        // Prevent HTTP/3 (QUIC) which is unstable on Render free tier
        const fetchOptions = {
            ...options,
            // These headers don't directly control protocol but help
            cache: 'no-store',
        };

        let lastError = null;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout
                
                const response = await fetch(url, {
                    ...fetchOptions,
                    signal: controller.signal,
                });
                
                clearTimeout(timeout);
                return response;
                
            } catch (error) {
                lastError = error;
                
                // Check if it's a retryable error
                const retryable = 
                    error.name === 'AbortError' ||
                    error.message.includes('QUIC') ||
                    error.message.includes('SUSPENDED') ||
                    error.message.includes('PING_FAILED') ||
                    error.message.includes('CONNECTION') ||
                    error.message.includes('Failed to fetch') ||
                    error.message.includes('NetworkError');

                if (attempt < retries && retryable) {
                    // Wait: 4s, 8s, 16s, 32s, 64s
                    const waitTime = Math.min(4000 * Math.pow(2, attempt), 65000);
                    console.log(`⏳ Server waking up... Retry ${attempt + 1}/${retries + 1} in ${waitTime/1000}s`);
                    await new Promise(r => setTimeout(r, waitTime));
                    continue;
                }
                throw error;
            }
        }
        throw lastError;
    }

    static async uploadFiles(files) {
        const formData = new FormData();
        files.forEach(f => formData.append('files', f.file));

        const endpoint = `${API_BASE_URL}/convert`;
        console.log(`📤 Uploading ${files.length} file(s)...`);

        const response = await this.fetchWithRetry(endpoint, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Server error (${response.status})`);
        }

        const contentType = response.headers.get('Content-Type');
        const contentDisposition = response.headers.get('Content-Disposition');
        const blob = await response.blob();

        console.log(`✅ Done: ${(blob.size / 1024).toFixed(1)} KB`);

        if (contentType && contentType.includes('zip')) {
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
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            
            const res = await fetch(`${API_BASE_URL}/stats`, {
                signal: controller.signal,
                cache: 'no-store',
            });
            
            clearTimeout(timeout);
            
            if (res.ok) return await res.json();
        } catch (e) {
            // Silent fail for stats
        }
        return null;
    }

    static async wakeUpServer() {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);
            
            const res = await fetch(`${API_BASE_URL}/health`, {
                signal: controller.signal,
                cache: 'no-store',
            });
            
            clearTimeout(timeout);
            
            if (res.ok) {
                console.log('⚡ Server is awake');
                return true;
            }
        } catch (e) {
            console.log('💤 Server sleeping');
        }
        return false;
    }
}

// ============================================================================
// UI Manager
// ============================================================================
class UIManager {
    constructor(state) {
        this.state = state;
        this.isConverting = false;
        this.statsInterval = null;
        this.elements = this.cacheElements();
        this.initEventListeners();
        this.state.subscribe(this.render.bind(this));
        this.loadStats();
        this.statsInterval = setInterval(() => {
            if (!this.isConverting) this.loadStats();
        }, 120000); // Every 2 minutes
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

        console.log(`📁 Selected ${heicFiles.length} file(s)`);

        const oversized = heicFiles.filter(f => f.size > MAX_FILE_SIZE);
        if (oversized.length) {
            this.showError(`Files exceeding 50MB: ${oversized.map(f => f.name).join(', ')}`);
        }

        heicFiles.filter(f => f.size <= MAX_FILE_SIZE).forEach(f => this.state.addFile(f));
        this.hideError();
    }

    async handleConvert() {
        const pending = this.state.getPendingFiles();
        if (!pending.length) {
            this.showError('No files to convert.');
            return;
        }

        this.isConverting = true;
        const fileCount = pending.length;

        console.log(`🔄 Converting ${fileCount} file(s)...`);

        this.elements.convertBtn.disabled = true;
        this.elements.convertBtn.innerHTML = '<span class="spinner"></span> Connecting to server...';
        
        pending.forEach(f => this.state.updateFile(f.id, { status: 'converting', progress: 10 }));

        // Update button text after 5 seconds to show we're still waiting
        const waitingMessages = [
            'Connecting to server...',
            'Server waking up...',
            'Almost there...',
            'Processing...',
        ];
        let msgIndex = 0;
        const msgInterval = setInterval(() => {
            msgIndex = (msgIndex + 1) % waitingMessages.length;
            if (this.elements.convertBtn.disabled) {
                this.elements.convertBtn.innerHTML = `<span class="spinner"></span> ${waitingMessages[msgIndex]}`;
            }
        }, 8000);

        try {
            const startTime = performance.now();
            const result = await ApiClient.uploadFiles(pending);
            clearInterval(msgInterval);
            
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
            console.log(`✅ Done in ${elapsed}s`);

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
                if (fileCount > BULK_DOWNLOAD_THRESHOLD) {
                    setTimeout(() => this.downloadBlob(result.blob, result.filename), 800);
                }
            }

            this.hideError();

        } catch (error) {
            clearInterval(msgInterval);
            console.error('❌ Failed:', error);
            pending.forEach(f => this.state.updateFile(f.id, {
                status: 'error', progress: 100,
                error: error.message || 'Conversion failed'
            }));
            this.showError(error.message || 'Server is unavailable. Please try again in a minute.');
        } finally {
            clearInterval(msgInterval);
            this.elements.convertBtn.disabled = false;
            this.elements.convertBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Convert All
            `;
            this.isConverting = false;
            setTimeout(() => this.loadStats(), 3000);
        }
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        console.log(`💾 Downloaded: ${filename}`);
    }

    downloadAllAsZip() {
        if (this.state.batchZipBlob) {
            this.downloadBlob(this.state.batchZipBlob, `converted_${this.state.getSuccessFiles().length}_images.zip`);
        }
    }

    showError(msg) {
        this.elements.errorMessage.textContent = msg;
        this.elements.errorSection.style.display = 'block';
        clearTimeout(this._errorTimeout);
        this._errorTimeout = setTimeout(() => this.hideError(), 15000);
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

        this.elements.convertBtn.disabled = !files.some(f => f.status === 'pending');
    }

    renderFileItem(f) {
        const icons = { pending: '📄', converting: '⏳', success: '✅', error: '❌' };
        const labels = { pending: 'Ready', converting: 'Waiting...', success: 'Done', error: 'Failed' };
        const width = f.status === 'converting' ? '30%' : f.status !== 'pending' ? '100%' : '0%';

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

// ============================================================================
// Initialize
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 HEIC to PNG Converter ready');
    const state = new AppState();
    const ui = new UIManager(state);

    // Wake server in background
    ApiClient.wakeUpServer();

    document.addEventListener('paste', (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const files = [];
        for (const item of items) {
            if (item.kind === 'file') {
                const file = item.getAsFile();
                const ext = file.name.split('.').pop()?.toLowerCase();
                if (ext === 'heic' || ext === 'heif') files.push(file);
            }
        }
        if (files.length > 0) {
            e.preventDefault();
            ui.handleFileSelect(files);
        }
    });
});