// Configuration - Auto-detect API URL
const API_BASE_URL = (() => {
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        return 'https://file-converter-api-iks5.onrender.com';
    }
    return 'http://127.0.0.1:8000';
})();

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const BULK_DOWNLOAD_THRESHOLD = 5;
const STATS_POLL_INTERVAL = 60000; // 60 seconds (reduced for free tier)

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
// API Client
// ============================================================================
// API Client
class ApiClient {
    static async uploadFiles(files) {
        const formData = new FormData();
        files.forEach(f => formData.append('files', f.file));

        const endpoint = `${API_BASE_URL}/convert`;
        console.log(`📤 Uploading ${files.length} file(s) to ${endpoint}`);

        // Render free tier cold start can take 30-60 seconds
        const maxRetries = 5;  // Increased from 2
        let lastError = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                // Longer timeout for cold starts
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 second timeout

                const response = await fetch(endpoint, {
                    method: 'POST',
                    body: formData,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || `Server error (${response.status})`);
                }

                const contentType = response.headers.get('Content-Type');
                const contentDisposition = response.headers.get('Content-Disposition');
                const blob = await response.blob();

                console.log(`✅ Response: ${contentType}, ${(blob.size / 1024).toFixed(1)} KB`);

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
            } catch (error) {
                lastError = error;
                
                // Check if it's a cold start or connection error
                const isColdStart = 
                    error.message.includes('SUSPENDED') ||
                    error.message.includes('Failed to fetch') ||
                    error.message.includes('NetworkError') ||
                    error.message.includes('CONNECTION') ||
                    error.message.includes('AbortError') ||
                    error.name === 'AbortError';

                if (attempt < maxRetries && isColdStart) {
                    // Exponential backoff: 3s, 6s, 12s, 24s, 48s
                    const waitTime = Math.min(3000 * Math.pow(2, attempt), 50000);
                    console.log(`⏳ Cold start detected. Retrying in ${waitTime / 1000}s... (${attempt + 1}/${maxRetries + 1})`);
                    
                    // Update UI to show we're waiting
                    const pending = files;
                    if (typeof this.updateStatus === 'function') {
                        this.updateStatus(`Waking up server... ${waitTime / 1000}s`);
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }
                throw error;
            }
        }
        throw lastError || new Error('Upload failed after all retries');
    }

    static async getStats() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout

            const res = await fetch(`${API_BASE_URL}/stats`, {
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                return data;
            }
        } catch (e) {
            // Silently fail for stats
        }
        return null;
    }

    // Wake up server with a ping (call on page load)
    static async wakeUpServer() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const res = await fetch(`${API_BASE_URL}/health`, {
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (res.ok) {
                console.log('⚡ Server is awake');
                return true;
            }
        } catch (e) {
            console.log('💤 Server is sleeping - will wake on first request');
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
        this.startStatsPolling();
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
        // Upload zone
        this.elements.uploadZone.addEventListener('click', () => this.elements.fileInput.click());
        this.elements.fileInput.addEventListener('change', (e) => {
            this.handleFileSelect(e.target.files);
            e.target.value = '';
        });

        // Drag and drop
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

        // Buttons
        this.elements.clearAllBtn.addEventListener('click', () => {
            if (this.state.getAllFiles().length > 0 && confirm('Clear all files?')) {
                this.state.clearAll();
            }
        });

        this.elements.convertBtn.addEventListener('click', () => this.handleConvert());
        this.elements.errorCloseBtn.addEventListener('click', () => this.hideError());

        // Prevent default drag
        document.addEventListener('dragover', e => e.preventDefault());
        document.addEventListener('drop', e => e.preventDefault());
    }

    // ============================================================================
    // Stats Polling
    // ============================================================================
    startStatsPolling() {
        this.loadStats();
        this.statsInterval = setInterval(() => {
            if (!this.isConverting) {
                this.loadStats();
            }
        }, STATS_POLL_INTERVAL);
    }

    stopStatsPolling() {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
    }

    // ============================================================================
    // File Handling
    // ============================================================================
    handleFileSelect(fileList) {
        const heicFiles = Array.from(fileList).filter(f => {
            const ext = f.name.split('.').pop()?.toLowerCase();
            return ext === 'heic' || ext === 'heif';
        });

        if (!heicFiles.length) {
            this.showError('Please select HEIC/HEIF files only.');
            return;
        }

        console.log(`📁 Selected ${heicFiles.length} HEIC file(s)`);

        const oversized = heicFiles.filter(f => f.size > MAX_FILE_SIZE);
        if (oversized.length) {
            const names = oversized.map(f => `${f.name} (${this.formatFileSize(f.size)})`).join(', ');
            this.showError(`Files exceeding 50MB: ${names}`);
        }

        const validFiles = heicFiles.filter(f => f.size <= MAX_FILE_SIZE);
        validFiles.forEach(f => this.state.addFile(f));

        if (validFiles.length) {
            this.hideError();
            setTimeout(() => {
                this.elements.filesSection.scrollIntoView({ behavior: 'smooth' });
            }, 100);
        }
    }

    // ============================================================================
    // Conversion
    // ============================================================================
    async handleConvert() {
        const pending = this.state.getPendingFiles();
        if (!pending.length) {
            this.showError('No files to convert.');
            return;
        }

        this.isConverting = true;

        console.log(`🔄 Starting conversion of ${pending.length} file(s)...`);

        this.elements.convertBtn.disabled = true;
        
        // Show different message for first request (cold start likely)
        this.elements.convertBtn.innerHTML = '<span class="spinner"></span> Connecting...';
        
        // Mark files as converting
        pending.forEach(f => this.state.updateFile(f.id, { 
            status: 'converting', 
            progress: 10  // Start at 10% to show progress
        }));

        try {
            const startTime = performance.now();
            const result = await ApiClient.uploadFiles(pending);
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

            console.log(`✅ Conversion complete in ${elapsed}s`);

            if (result.type === 'single') {
                this.state.updateFile(pending[0].id, {
                    status: 'success',
                    progress: 100,
                    convertedBlob: result.blob,
                    convertedName: result.filename,
                    convertedSize: result.blob.size
                });
                // Auto-download single file
                setTimeout(() => this.downloadBlob(result.blob, result.filename), 500);
            } else {
                this.state.batchZipBlob = result.blob;
                pending.forEach(f => {
                    this.state.updateFile(f.id, {
                        status: 'success',
                        progress: 100,
                        convertedBlob: result.blob,
                        convertedName: result.filename,
                        convertedSize: result.blob.size
                    });
                });
                // Auto-download ZIP for bulk
                if (pending.length > BULK_DOWNLOAD_THRESHOLD) {
                    setTimeout(() => this.downloadBlob(result.blob, result.filename), 800);
                }
            }

            this.hideError();

        } catch (error) {
            console.error('❌ Conversion failed:', error);
            pending.forEach(f => this.state.updateFile(f.id, {
                status: 'error',
                progress: 100,
                error: error.message || 'Conversion failed'
            }));
            this.showError(error.message || 'An error occurred during conversion.');

        } finally {
            // Re-enable button
            this.elements.convertBtn.disabled = false;
            this.elements.convertBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Convert All
            `;

            // Allow stats again and refresh
            this.isConverting = false;
            setTimeout(() => this.loadStats(), 2000);
        }
    }

    // ============================================================================
    // Download
    // ============================================================================
    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        console.log(`💾 Downloaded: ${filename} (${this.formatFileSize(blob.size)})`);
    }

    downloadAllAsZip() {
        if (this.state.batchZipBlob) {
            const count = this.state.getSuccessFiles().length;
            this.downloadBlob(this.state.batchZipBlob, `converted_${count}_images.zip`);
        }
    }

    // ============================================================================
    // Error Handling
    // ============================================================================
    showError(msg) {
        console.error(`❌ ${msg}`);
        this.elements.errorMessage.textContent = msg;
        this.elements.errorSection.style.display = 'block';
        // Auto-hide after 10 seconds
        clearTimeout(this._errorTimeout);
        this._errorTimeout = setTimeout(() => this.hideError(), 10000);
    }

    hideError() {
        this.elements.errorSection.style.display = 'none';
        clearTimeout(this._errorTimeout);
    }

    // ============================================================================
    // Stats
    // ============================================================================
    async loadStats() {
        const stats = await ApiClient.getStats();
        if (stats) {
            this.elements.todayCount.textContent = stats.conversions_today || 0;
            if (stats.total_files_converted) {
                this.elements.todayCount.title =
                    `Total: ${stats.total_conversions} conversions | ` +
                    `Files: ${stats.total_files_converted} | ` +
                    `Data: ${stats.total_mb_processed} MB`;
            }
        }
    }

    // ============================================================================
    // Formatting
    // ============================================================================
    formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 Bytes';
        const units = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ============================================================================
    // Render
    // ============================================================================
    render(files) {
        const filesArray = files;

        // Toggle files section
        if (filesArray.length > 0) {
            this.elements.filesSection.style.display = 'block';
            this.elements.fileCount.textContent = filesArray.length;
        } else {
            this.elements.filesSection.style.display = 'none';
        }

        // Render file grid
        this.elements.filesGrid.innerHTML = filesArray.map(f => this.renderFileItem(f)).join('');

        // Attach event listeners
        filesArray.forEach(f => {
            const dBtn = document.getElementById(`dl-${f.id}`);
            if (dBtn) {
                dBtn.onclick = () => this.downloadBlob(f.convertedBlob, f.convertedName);
            }
            const rBtn = document.getElementById(`rm-${f.id}`);
            if (rBtn) {
                rBtn.onclick = () => this.state.removeFile(f.id);
            }
        });

        // Download All section
        const successCount = filesArray.filter(f => f.status === 'success').length;
        if (successCount > 0 && this.state.batchZipBlob) {
            this.elements.downloadAllSection.innerHTML = `
                <div class="bulk-download-card">
                    <div class="bulk-download-info">
                        <span class="bulk-download-icon">📦</span>
                        <div>
                            <strong>Batch Download Ready</strong>
                            <p>${successCount} file${successCount > 1 ? 's' : ''} converted successfully</p>
                        </div>
                    </div>
                    <button class="btn btn-primary btn-large" id="downloadAllBtn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                        Download All as ZIP
                    </button>
                </div>`;
            this.elements.downloadAllSection.classList.remove('hidden');
            const downloadAllBtn = document.getElementById('downloadAllBtn');
            if (downloadAllBtn) {
                downloadAllBtn.onclick = () => this.downloadAllAsZip();
            }
        } else if (successCount > 0) {
            this.elements.downloadAllSection.innerHTML = `
                <p class="text-center text-gray-600 text-sm">
                    ✅ ${successCount} file${successCount > 1 ? 's' : ''} ready. Download individually above.
                </p>`;
            this.elements.downloadAllSection.classList.remove('hidden');
        } else {
            this.elements.downloadAllSection.classList.add('hidden');
        }

        // Update convert button
        const hasPending = filesArray.some(f => f.status === 'pending');
        this.elements.convertBtn.disabled = !hasPending;
    }

    renderFileItem(f) {
        const icons = { pending: '📄', converting: '⚙️', success: '✅', error: '❌' };
        const labels = { pending: 'Ready', converting: 'Converting...', success: 'Done', error: 'Failed' };
        const barClass = f.status === 'success' ? 'complete' : f.status === 'error' ? 'error' : '';
        const width = f.status === 'converting' ? '50%' : f.status !== 'pending' ? '100%' : '0%';

        let action = '';
        if (f.status === 'success') {
            if (this.state.getSuccessFiles().length <= BULK_DOWNLOAD_THRESHOLD) {
                action = `<button class="btn btn-primary btn-small" id="dl-${f.id}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    Download
                </button>`;
            } else {
                action = '<span class="badge badge-success">In ZIP</span>';
            }
        } else if (f.status === 'error') {
            action = `<button class="btn btn-secondary btn-small" id="rm-${f.id}">✕ Remove</button>`;
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
                    ${f.status !== 'pending' ? `
                        <div class="file-progress">
                            <div class="file-progress-bar ${barClass}" style="width:${width}"></div>
                        </div>
                    ` : ''}
                </div>
                <div class="file-actions">${action}</div>
            </div>`;
    }
}

// ============================================================================
// Initialize Application
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 HEIC to PNG Converter initialized');
    
    const state = new AppState();
    const ui = new UIManager(state);

    // Wake up the Render server in background
    ApiClient.wakeUpServer().then(awake => {
        if (awake) {
            ui.loadStats();
        }
    });

    // Handle paste events for HEIC files
    document.addEventListener('paste', (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const files = [];
        for (const item of items) {
            if (item.kind === 'file') {
                const file = item.getAsFile();
                const ext = file.name.split('.').pop()?.toLowerCase();
                if (ext === 'heic' || ext === 'heif') {
                    files.push(file);
                }
            }
        }

        if (files.length > 0) {
            e.preventDefault();
            ui.handleFileSelect(files);
        }
    });

    console.log('✅ Ready for conversion');
});